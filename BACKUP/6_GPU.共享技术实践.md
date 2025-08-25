# [GPU 共享技术实践](https://github.com/HuihuangZhang/blog/issues/6)

> 以下讨论的内容都是基于 nvidia 的显卡

# 1. 基础知识

GPU 共享技术主要为了提供 GPU 的利用效率，计算效率和 vRAM 的利用效率。[^6]

我了解到的 GPU 共享技术有以下 3 种：
1. Time Slicing
2. MPS (Multi Process Service)
3. MIG (Multi Instance GPU)

Time Slicing 是类似于 CPU 的分时技术，可以将计算资源均分成多份（具体多少份依赖 `replicas` 配置），由多个服务共享一个 GPU。但 Time Slicing 技术没有划分 vRAM，vRAM 是共享的，没有 vRAM 隔离，可能会引起 vRAM OOM 问题。 例如原本的 vRAM 为 40Gb，`replicas` 为 2，服务 A 和服务 B 共享该 GPU 卡，服务 A 需要 30Gb vRAM，服务 B 需要 25Gb vRAM，因为 55Gb(30Gb + 25Gb) > 40Gb，在使用过程中会导致 OOM。

> The GPU Memory Management Model
> - No Paging: Unlike a CPU and system RAM (DRAM), a GPU generally does not have a robust virtual memory system with "paging." The CPU's operating system (OS) can move pages of data from physical RAM to a hard drive or SSD (swap space) and back again as needed. This allows the OS to run processes that require more memory than is physically available, albeit with a huge performance penalty.
> - VRAM is "Pinned": When a process allocates memory on the GPU, that memory is "pinned" to the GPU's VRAM. It stays there until the process explicitly frees it.
> - The Context Switch: When the GPU scheduler switches from Process A to Process B, it saves the "context" of Process A (e.g., the state of the registers, program counter, etc.) and loads the context of Process B. It then starts executing Process B. The VRAM allocated to Process A is not touched; it remains in place.

MPS (Multi Process Service) 和 Time Slicing 技术基本类似，但 MPS 提供了 vRAM 的大小控制，通过 `memoryGB` 参数约束分到的 vRAM 大小。起到了一定的 vRAM 隔离作用，防止同一个 GPU 上的一个服务拖垮另一个服务。

Time Slicing vs. MPS

Feature | NVIDIA Time-Slicing | NVIDIA Multi-Process Service (MPS)
-- | -- | --
Concurrency Type | Temporal (Round-robin scheduling) | Spatial (Concurrent kernel execution)
Context Switching | High overhead between processes | Low overhead (shared context)
Memory Isolation | None. Processes can't set VRAM limits. | Limited/Partial. On newer GPUs (Volta and later), it provides a separate VRAM address space, but not full isolation or memory limits. Processes can still oversubscribe the GPU.
Use Case | Multiple small, infrequent jobs; legacy GPUs. | High-throughput, low-latency workloads with many concurrent requests.
VRAM Management | No VRAM limits or partitioning. | No VRAM limits or partitioning.

> [!IMPORTANT]
> 需要注意：**Time Slicing 和 MPS 是互斥的**


MIG (Multi Instance GPU) 将一张 GPU 卡按照 GPC(Graphics Processing Cluster) 和 vRAM 来进行切割，计算单元和显存都完全隔离。是目前最安全的 GPU 共享技术。但支持 MIG 的 GPU 型号有限，切割的规格有限，具体可以参考 [MIG User Guide - Supported MIG Profiles](https://docs.nvidia.com/datacenter/tesla/mig-user-guide/index.html#supported-mig-profiles)。


- [ ] 阅读：

# 2. 实践

## 2.1. K8s

安装 `nvidia/gpu-operator`：

> 我使用的 gpu-operator chart 版本是 gpu-operator-v25.3.0

```bash
kubectl create ns gpu-operator

helm repo add nvidia https://helm.ngc.nvidia.com/nvidia \
    && helm repo update

helm install --wait --generate-name \
     -n gpu-operator --create-namespace \
     nvidia/gpu-operator \
     --set driver.enabled=false
# 因为安装的机器上已经有驱动了，所以这里将 driver.enabled 设置成 false。否则 gpu-operator 会在机器上安装驱动程序
```

helm 安装完毕后，运行 `kubectl -n gpu-operator exec -it nvidia-driver-daemonset-xxx -- nvidia-smi` 得到的结果和在机器上运行 `nvidia-smi` 结果一致。

也可以通过 `kubectl get node xxx -oyaml` 查看节点上的 `capacity` 中的 `nvidia.com/gpu` 信息，例如：

```
# xxx
  capacity:
    cpu: "112"
    ephemeral-storage: 1509315168Ki
    hugepages-1Gi: "0"
    hugepages-2Mi: "0"
    memory: 462075016Ki
    nvidia.com/gpu: "8"
    pods: "110"
```

### 2.1.1. Time Slicing[^4]

> 使用 L40s GPU 机器

新建配置，`time-slicing-config-fine.yaml` ：

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: time-slicing-config-fine
data:
  l40s: |-
    version: v1
    flags:
      migStrategy: none
    sharing:
      timeSlicing:
        resources:
        - name: nvidia.com/gpu
          replicas: 2
```

执行 `kubectl create -f time-slicing-config-fine.yaml -n gpu-operator` 创建 configMap，`metadata.name` 会在配置 `cluster-policy` 时被用到。

执行 `kubectl edit  clusterpolicies.nvidia.com/cluster-policy -n gpu-operator`，修改 `devicePlugin.config.name` 为 `metadata.name`（即 ` time-slicing-config-fine`）。或者直接执行以下命令：

```
kubectl patch clusterpolicies.nvidia.com/cluster-policy \
    -n gpu-operator --type merge \
    -p '{"spec": {"devicePlugin": {"config": {"name": "time-slicing-config-fine"}}}}'
```

执行 `kubectl label node <NODE-NAME> nvidia.com/device-plugin.config=l40s` 将节点打上标签，理论上 `nvidia-device-plugin-daemonset-xxx` pod 检测到标签的变化，会自动执行对应的操作，如果没有，可以手动删除对应节点的 `nvidia-device-plugin-daemonset-xxx` pod。

等 Time Slicing 操作结束后，通过 `kubectl describe node <NODE-ID>` 可以看到 labels 中 `nvidia.com/gpu.replicas` 和 `nvidia.com/gpu.sharing-strategy` 有了相应的变化。`Capacity` 的 `nvidia.com/gpu` 被修改成了 16 (8*2)。

### 2.1.2. MPS

延续 2.1.1. 中的 configMap，往 `time-slicing-config-fine.yaml` 中添加如下配置：

```
apiVersion: v1
kind: ConfigMap
metadata:
  name: time-slicing-config-fine
data:
  l40s: |-
    version: v1
    flags:
      migStrategy: none
    sharing:
      timeSlicing:
        resources:
        - name: nvidia.com/gpu
          replicas: 2
  l40s-mps: |-
    version: v1
    flags:
      migStrategy: none
    sharing:
      mps:
        resources:
          - name: nvidia.com/gpu
            rename: nvidia.com/gpu-24gb
            memoryGB: 24
            replicas: 2
            devices: all
```


> [!NOTE]
>  **其中配置中 `memoryGB` 参数是 MPS 和 Time Slicing 的主要差异。**

执行 `kubectl label node <NODE-NAME> nvidia.com/device-plugin.config=l40s-mps` 将节点打上标签，后面的流程就和 2.1.1. 中的一致了。

执行 `kubectl describe <NODE-NAME>` 可以看到 `nvidia.com/mps.capable=true`，`nvidia.com/gpu.sharing-strategy=mps`。

#### 问题：在申请多个 gpu 资源时，报了 `maximum request size for shared resources is 1` 的错误

主要是 failRequestsGreaterThanOne 这个参数引起的问题[^1][^2][^3]。在对 GPU 做了 MPS 后，failRequestsGreaterThanOne 强制为 true [^3]，这意味着不允许在操作了 MPS 的机器上申请超过 1 个 GPU 资源。


### 2.1.3. MIG

> 在 A100 80G PCIe 机器上尝试，要做 MIG，需要确认 GPU 型号是否支持 MIG 操作。[^5] 可以通过 `nvidia.com/mig.capable` 的值判断。

可以在 `cluster-policy` 层面配置 `mig.strategy`，或者在单独的 configMap 中配置 `flags.migStrategy` 字段。 `cluster-policy` 是全局的，集群粒度的配置，configMap 中是更细粒度的。

```bash
# Example: Patching to a 'single' strategy
kubectl patch clusterpolicies.nvidia.com/cluster-policy --type='json' -p='[{"op": "replace", "path": "/spec/mig/strategy", "value":"single"}]'

# Example: Patching to a 'mixed' strategy
kubectl patch clusterpolicies.nvidia.com/cluster-policy --type='json' -p='[{"op": "replace", "path": "/spec/mig/strategy", "value":"mixed"}]'
```

> [!NOTE]
> `mig.strategy=single` vs. `mig.strategy=mixed`
> - `single` 会均等地切割 gpu
> - `mixed` 允许按照英伟达规定的规格来切割 gpu[^5]


新建配置， `mig-config-fine.yaml`:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: mig-config-fine
  namespace: gpu-operator
data:
  config.yaml: |
    version: v1
    flags:
      migStrategy: mixed
    mig-configs:
      a100-80gb-4:
        - devices: [0]
          mig-enabled: true
          mig-devices:
            "7g.80gb": 1
        - devices: [1, 2]
          mig-enabled: true
          mig-devices:
            "2g.20gb": 2
            "3g.40gb": 1
        - devices: [3]
          mig-enabled: true
          mig-devices:
            "1g.20gb": 1
            "2g.20gb": 3
```

执行 `kubectl create -f mig-config-fine.yaml -n gpu-operator` 创建 configMap，`metadata.name` 会在配置 `cluster-policy` 时被用到。
上述配置中，根据 nvidia 官网 A100 型号的 MIG 支持[^5]，将 4 张 80 gb 的 GPU 卡机切割成不同的规格，1 * 7g.80gb + 7 * 2g.20gb + 2 * 3g.40gb + 1 * 1g.20gb（总体是 28g.320gb）

运行 kubectl edit clusterpolicies.nvidia.com/cluster-policy 命令编辑对应的配置：

```yaml
# ...
  mig:
    strategy: mixed
  migManager:
    config:
      default: all-disabled
      name: mig-config-fine # 这里写 ConfigMap 的名字
    enabled: true
# ...
```

执行 `kubectl label node <NODE-NAME> nvidia.com/mig.config=a100-80gb-4 --overwrite`配置节点的 mig 策略，然后静静等待 `nvidia-mig-manager-xxx` 按照配置信息进行 MIG 操作。可以通过 `kubectl logs -n gpu-operator nvidia-mig-manager-xxx` 查看日志。

通过节点的 `nvidia.com/mig.config.state` 标签也可以查看 mig 操作的进度，如果 `nvidia.com/mig.config.state=success` 则表示 mig 操作成功。

#### 操作 MIG 时，GPU 被占用

查看 `nvidia-mig-manager-xxx` 的日志，看到如下错误：

```
\nThe following GPUs could not be reset:\n  GPU 00000000:F9:00.0: In use by another client\n  GPU 00000000:FB:00.0: In use by another client\n  GPU 00000000:FD:00.0: In use by another client\n  GPU 00000000:FF:00.0: In use by another client\n\n4 devices are currently being used by one or more other processes (e.g., Fabric Manager, CUDA application, graphics application such as an X server, or a monitoring application such as another instance of nvidia-smi). Please first kill all processes using these devices and all compute applications running in the system.\n
```

但在 gpu 的宿主机上通过 `nvidia-smi` 命令看不到任何进程占用。执行 `sudo fuser -v /dev/nvidia*` 命令查看哪些进程在使用：

<img width="1246" height="788" alt="Image" src="https://github.com/user-attachments/assets/bcc38ae2-5872-4640-9845-26acbcc9ab6e" />

通过命令 `systemctl stop sensecore-telemetry-ecs`  关闭对应的服务，执行 `kubectl delete -n gpu-operator pod nvidia-mig-manager-xxx` 重新触发 mig 操作，mig 结果正常。

### 2.1.4. 撤销 gpu 共享操作

执行 `kubectl cordon <NODE-NAME>` 将节点设置为不可调度，等确保所有节点被迁移出该节点后（确保 GPU 不会被其他程序占用，可能会出问题），执行 `kubectl label node <NODE-NAME> nvidia.com/device-plugin.config-` 去除对应的 label。静静等待 gpu-operator 操作结束即可。如果还有问题，重启机器。确保 `nvidia.com/device-plugin.config` 不存在或者为 none，执行 `kubectl uncordon <NODE-NAME>`。


# 参考

[^1]: [Advanced Configuration Sharing Access to GPUs](https://superorbital.io/blog/gpu-kubernetes-nvidia-advanced-troubleshooting/)
[^2]:  [MPS with Kubernetes on NVIDIA GPU #443](https://github.com/NVIDIA/k8s-device-plugin/issues/443#issuecomment-2090224764) 
[^3]:  [NVIDIA k8s-device-plugin Commit 95be083](https://github.com/NVIDIA/k8s-device-plugin/commit/95be08329d6ea5aca582748080deaa2dad964c19) 
[^4]: [NVIDIA device plugin for Kubernetes - With CUDA Time-Slicing](https://github.com/NVIDIA/k8s-device-plugin?tab=readme-ov-file#with-cuda-time-slicing)
[^5]: https://docs.nvidia.com/datacenter/tesla/mig-user-guide/index.html#a100-mig-profiles
[^6]: [Improving GPU Utilization in Kubernetes](https://developer.nvidia.com/blog/improving-gpu-utilization-in-kubernetes)

