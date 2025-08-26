# [rancher 部署 & 使用](https://github.com/HuihuangZhang/blog/issues/5)

# 1. 背景

考虑使用 rancher 的原因：

1. 对于集群管理人员，rancher 是一个开源的 k8s 集群管理产品，支持同时管理多个 k8s 集群，基本满足目前的多集群管理需求；
2. 对于 devops 同学或者 开发者，rancher 可以使用 helm chart 的形式来发布，也支持导出 kubeconf，用命令行的形式来发布；
3. rancher 支持 LDAP 集成登录；

# 2. 安装

使用 docker 形式来部署 rancher。

一开始考虑将 rancher 部署进 dev 环境的 k8s 集群中，但一直部署不成功。思考后觉得，devops 工具就是应该和需要管理的集群分开部署，不然集群挂了，rancher 工具也没办法使用了（后知后觉）。


```
    docker run \
        --restart=unless-stopped \
        -p 60080:80 \
        -p 60443:443 \
        --privileged \
        --name rancher \
        -d rancher/rancher:stable
```

如果使用 docker 部署， rancher 会在 docker 内启动一个 k3s 集群。安装 rancher 的机器规格和 rancher 能管理的集群数量和机器节点的关系可以看：[K3s Kubernetes](https://ranchermanager.docs.rancher.com/v2.8/getting-started/installation-and-upgrade/installation-requirements#k3s-kubernetes)（这个和后面的一个问题相关）

> [!NOTE]
> 可以尝试在本地搭建 k3s 集群，之后在该集群安装 rancher 作为管理集群。

启动后，因为要集成 SSL，所以在 rancher 前面加了一层 nginx 反向代理（可以参考[Installing Rancher Server With SSL](https://www.rancher.com/docs/rancher/v1.6/en/installing-rancher/installing-server/basic-ssl-config/#notes-on-the-settings)），重点是 rancher 需要支持 websocket 进行通信，对应的 `nginx.conf`：

```
worker_processes auto;

events {
    worker_connections 8192;
}

http {
    upstream rancher {
        server 127.0.0.1:60080;
    }

    map $http_upgrade $connection_upgrade {
        default Upgrade;
        ''      close;
    }
    server {
        listen 80;
        server_name rancher.xxx.com;
        return 301 https://$host$request_uri;
    }
    server {
        listen 443 ssl http2;
        server_name rancher.xxx.com;

        ssl_certificate /data/cert/moscom/mm.pem;
        ssl_certificate_key /data/cert/moscom/mm.key;

        location / {
            proxy_set_header Host $host;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_set_header X-Forwarded-Port $server_port;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_pass http://rancher;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection $connection_upgrade;
            proxy_read_timeout 900s;
            proxy_buffering off;
        }
    }
}
```

# 3. 使用

## 3.1. 集成 LDAP

使用 admin 账户登录 rancher 平台，进入左侧的 `Users & Authentication - Auth Provider`，选择 LDAP。按照所需填写字段内容。

> [!NOTE]
> 还没有尝试集成 LDAP 的 group 能力，后续尝试

## 3.2. 授权

集成 LDAP 之后，可以对用户进行授权。rancher 平台支持对用户进行较细粒度的授权，例如到 `cluster`，`namespace`，`project`。

因为集群中会有其他非业务服务的 `namespace`，为了避免普通开发者误操作，建议在 `Cluster - Projects/Namespaces` 中新建 project，包含业务的 namespace，然后对于普通开发者，单独针对该 project 进行授权。

新建 project
<img width="1920" height="958" alt="Image" src="https://github.com/user-attachments/assets/aeb4b071-b03d-483a-a9f8-7c3c7666bd02" />


对 project 进行授权
<img width="1920" height="958" alt="Image" src="https://github.com/user-attachments/assets/7e81facd-09b8-4df7-9073-4787dc63ebc2" />


## 3.3. App & helm

rancher 支持使用 helm chart 形式来发布、回滚服务。

支持使用 git 仓库来管理 helm chart 文件夹（不是 `helm package` 之后的 zip 包），只需要配置特定的 ssh key（作为 git 命令拉取数据的凭证）和分支名字即可。配置后，如果一切正常，可以在 `Apps - Repositories` 中看到对应的 helm chart 仓库，是 Active 状态。在右侧可以手动更新同步该仓库的内容。

## 3.4. helm chart 管理

在 helm chart 的管理上，如果正常使用 `helm create` 命令来创建的 chart，其中的 `values.yaml` 会包含很多配置项，例如 image 的配置、ingress 的配置、hpa 的配置等。从 `values.yaml` 的字段角度看，可大致将字段分成两类，一类是运维同学需要关注的；一类是开发同学需要关注的。

考虑到 rancher 支持 helm chart 发布和 gitlab CI ，提出了“两阶段 helm chart 管理”的方案。

方案的考虑点是：
1. 根据**开发角色关注点**来分离 `values.yaml` 文件中配置项。即不同角色关注的 `values.yaml` 文件不同；
2. 根据**部署环境**来分离 `values.yaml` 文件中的配置项。即 dev 、prod 环境的 `values.yaml` 文件不同；

### 整体方案

<img width="947" height="546" alt="Image" src="https://github.com/user-attachments/assets/35e81338-0148-4f0e-91c3-2eef78fcd809" />

在 stage1 中，helm chart 的目录结构大体和 `helm create` 命令生成的目录相同，但添加了额外的文件。举例如下：

```
.
├── Chart.yaml
├── dev-values.yaml
├── env.yaml
├── prod-values.yaml
├── templates
│   ├── _helpers.tpl
│   ├── deployment.yaml
│   ├── hpa.yaml
│   ├── ingress.yaml
│   ├── NOTES.txt
│   ├── service.yaml
│   ├── serviceaccount.yaml
│   └── tests
│       └── test-connection.yaml
└── values.yaml
```

其中需要关注的文件有：

- `values.yaml`：用来放置跟部署环境无关的配置项，例如 `image`、`imagePullSecrets`、`service` 配置；
- `dev-values.yaml` 和 `prod-values.yaml` ：用来放置环境相关配置，例如 `resource`、 `ingress` 配置；
- `env.yaml`：单独隔离一个文件用来放置初始化服务的环境变量；

在 stage2 中，helm chart 的目录结构被简化为如下：

```
.
├── Chart.yaml
├── templates
│   └── biz-service.yaml
└── values.yaml
```

所有相关的配置都被放置在 `biz-service.yaml` 文件中，`values.yaml` 文件只暴露 `image.tag` 和 `env` 两个和开发同学部署相关的配置。

stage1 到 stage2 的变更是依赖 gitlab CI 工具自动化执行的（参考 [脚本](#helm更改自动化脚本示例)）。意味着如果运维同学改动了服务的配置，则相关的改动会被自动整理后同步到 dev 和 prod 环境的发布配置文件中。


## 3.5. Monitoring

打开 `Cluster - Tools` 可以看到 Monitoring 的工具，我安装的是 v103.2.2+up57.0.3 的版本。勾选 `Customize Helm options before install`，其中 pv 使用的是 `nfs-provisioner` 进行分配，其余没有额外的配置。

对应的 namespace 是 `cattle-monitoring-system`，等待所有相关的资源启动。所有资源正常启动后，在 rancher 的侧边栏可以看到 `Monitoring` ，其中集成了 prometheus、grafana。

### 集成 gpu-operator 的监控面板

> k8s 集群中已经安装了 `gpu-operator`，以下的描述都是基于此

gpu-operator 已经集成了 nvidia-dcgm-exporter，理论上每个 GPU 机器上都有一个 exporter，可以用于 prometheus 收集数据。

在 prometheus targets 中没有找到 dcgm 相关的信息。执行 `kubectl get servicemonitors -A` 命令，没有看到 dcgm-exporter 的 ServiceMonitor。

新建 `dcgm-exporter-servicemonitor.yaml` 配置文件：

```
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: nvidia-dcgm-exporter
  namespace: gpu-operator
spec:
  selector:
    matchLabels:
      app: nvidia-dcgm-exporter
  endpoints:
    - port: gpu-metrics
      interval: 30s
```

> [!IMPORTANT]
>  ServiceMonitor 配置中：
> 1. `metadata.namespace` 必须和需要收集指标的 Service 同一个 namespace；
> 2. `spec.selector.matchLabels` 需要和对应 Service 的 labels 保持一致，确保能抓取到对应 Service 的数据；
> 3. `endpoints[0].port` 需要和对应的对应 Service 的保持一致；

执行 `kubectl get pod -n gpu-operator | grep dcgm` 查看，看到 exporter 对应的 service：

```
# kubectl get svc -n gpu-operator
NAME                   TYPE        CLUSTER-IP       EXTERNAL-IP   PORT(S)    AGE
gpu-operator           ClusterIP   10.101.116.210   <none>        8080/TCP   104d
nvidia-dcgm-exporter   ClusterIP   10.100.99.208    <none>        9400/TCP   104d

# kubectl describe svc nvidia-dcgm-exporter -n gpu-operator 
Name:                     nvidia-dcgm-exporter
Namespace:                gpu-operator
Labels:                   app=nvidia-dcgm-exporter
Annotations:              prometheus.io/scrape: true
Selector:                 app=nvidia-dcgm-exporter
Type:                     ClusterIP
IP Family Policy:         SingleStack
IP Families:              IPv4
IP:                       10.100.99.208
IPs:                      10.100.99.208
Port:                     gpu-metrics  9400/TCP
TargetPort:               9400/TCP
Endpoints:                10.245.2.8:9400,10.245.5.35:9400,10.245.4.252:9400
Session Affinity:         None
Internal Traffic Policy:  Cluster
Events:                   <none>
```

执行 `kubectl apply -f dcgm-exporter-servicemonitor.yaml`，等待几分钟， prometheus 收集数据。正常的情况下，可以在 `Monitoring - Prometheus Targets` 中找到，并显示 UP 状态。


<img width="1905" height="633" alt="Image" src="https://github.com/user-attachments/assets/50af7704-fac5-4686-8fce-327bc9557406" />

进入 `Monitoring - Grafana` ，在 grafana UI 中添加 dashboard。需要进行登录操作，原始账号信息是 `admin/prom-operator`。导入 dashboard，输入 `12219`，可以看到对应的面板信息。

# 附录 A

## A.1 问题记录

### 解绑后重新绑定 ldap，rancher UI 会出现 namespace 未被删除的错误

原因是 rancher 通过 namespace 来管理每个用户的配置，如果通过 docker 安装的 rancher，可以通过 `docker exec -it rancher /bin/bash` `kubectl get ns` 来查看。（这也说明了本地安装时 rancher 需要 k3s 环境的原因）

在出现问题时，可以看到多个 namespace 都处于 terminating 的状态，但一直杀不死。通过 `kubectl get <ns> -o json` ，可以看到 `.spec.finalizers` 是 `kubernetes`。[^1]

> If uninstall gets stuck it is likely due to finalizers. Resource status fields, e.g. on a namespace, will list the resources waiting for their finalizers to be removed. The finalizers can be removed manually with kubectl, if their controllers are no longer running. [^2]

在容器内使用以下命令 [^3] 删除掉 namespace 绑定的 `finalizers` 变量，之后 namespace 就可以被正常删除了。

```
NAMESPACE=""
kubectl get -o json namespace $NAMESPACE | tr -d "\n" | sed "s/\"finalizers\": \[[^]]\+\]/\"finalizers\": []/"   | kubectl replace --raw /api/v1/namespaces/$NAMESPACE/finalize -f -
```

## A.2 <a name="helm更改自动化脚本示例"></a>

`process.sh` 脚本文件内容如下：

```bash
#!/bin/bash

set -x
set -e

DEV_NAMESPACE="mos"
PROD_NAMESPACE="prod"
DEV_HELM_CHART_BRANCH="try-dev"
PROD_HELM_CHART_BRANCH="try-prod"

CD_GITLAB_TOKEN="<GITLAB-TOKEN>"

SERVICE_HELM_CHARTS_DIR="service-helm-charts"

sed="sed"
# if in mac os, use gsed
if [[ "$(uname)" == "Darwin" ]]; then
    sed="gsed"
else
    sed="sed"
fi

function git_clone_repo() {
    local repo_url=$1

    git config --global credential.helper store
    echo "https://${CD_GITLAB_TOKEN}@code.xxx.com" > ~/.git-credentials

    local repo_name=$(basename "$repo_url" .git)
    git clone $repo_url $SERVICE_HELM_CHARTS_DIR
}

function git_add_commit_push() {
    local repo_path=$1
    local branch_name=$2
    local commit_message=$3

    pushd "$repo_path"
    
    # if nothing changes, skip
    if [[ -z $(git status --porcelain) ]]; then
        echo "No changes to commit in $repo_path"
        popd
        return
    fi
    
    git add .
    git commit -m "$commit_message"
    git push origin $branch_name
    
    popd
}

# create_helm_folder 
# This function creates an empty Helm chart folder structure with a Chart.yaml, .helmignore, and values.yaml file.
# @Param $1: env - The environment for which the Helm chart is being created (e.g., dev, prod)
# @Param $2: repo_path - The path to the repository where the Helm chart folder will be created
function create_helm_folder() {
    local env=$1
    local repo_path=$2
    local chart_name=$3

    echo "Creating Helm folder for $repo_path"
    
    mkdir -p "$repo_path/templates"
    
    touch "$repo_path/Chart.yaml"
    touch "$repo_path/.helmignore"
    
    cat << EOF > "$repo_path/values.yaml"
# Default values for $repo_path.
image:
  tag: ""
EOF
    if [[ -f "./$chart_name/env.yaml" ]]; then
        echo "Adding environment variables from $chart_name/env.yaml"
        cat "$chart_name/env.yaml" >> "$repo_path/values.yaml"
        # replace <ENV> with the actual environment
        $sed -i -E "s/<ENV>/$env/g" "$repo_path"/values.yaml
        $sed -i -E "s/<REL_ENV>/$env/g" "$repo_path"/values.yaml
        $sed -i -E "s/<mosv2-ENV>/mosv2-$env/g" "$repo_path"/values.yaml
    else
        echo "No env.yaml found in $chart_name, skipping env variables."
    fi
    echo "Helm folder created at $repo_path"
}

function process_target_helm_chart() {
    local env=$1
    local source_chart_tpl_path=$2
    local target_repo_path=$3
    local target_chart_name=$4

    local target_branch=$(get_target_branch_by_env "$env")
    
    # print all inputs to debug
    echo "Processing target helm chart with inputs:"
    echo "Target branch: $env $target_branch"
    echo "Source chart template path: $source_chart_tpl_path"
    echo "Target repo path: $target_repo_path"
    echo "Target chart name: $target_chart_name"
    
    # 将 image.tag 替换为 {{ .Values.image.tag }}
    $sed -i -E -e 's/([[:space:]]*image:[[:space:]]+")(mos-cn-beijing|registry\.cn-sh-01\.sensecore\.cn)([^:]*):[^"]+"/\1\2\3:{{ .Values.image.tag }}"/g' $source_chart_tpl_path

    # 添加上 env 的模版
    $sed -i -E -e '/[[:space:]]*resources/i \
          {{- with .Values.env }} \
          env:\
            {{- toYaml . | nindent 12 }}\
          {{- end }}' $source_chart_tpl_path

    ## debug
    # cat $source_chart_tpl_path
    
    # checkout to dev branch
    echo "pwd: $(pwd)"
    pushd "$target_repo_path"
    git fetch origin $target_branch
    git checkout $target_branch
    popd

    # if helm directory does not exist, create it
    if [[ ! -d "$target_repo_path/$target_chart_name" ]]; then
        echo "Creating directory $target_repo_path/$target_chart_name"
        create_helm_folder "$env" "$target_repo_path/$target_chart_name" "$target_chart_name"
    fi
    
    # add the dev/prod values to the helm-charts repo
    cp $source_chart_tpl_path "$target_repo_path/$target_chart_name/templates/$target_chart_name.yaml"
    
    # add chart-related files
    cp "$target_chart_name/Chart.yaml" "$target_repo_path/$target_chart_name/Chart.yaml"
    cp "$target_chart_name/.helmignore" "$target_repo_path/$target_chart_name/.helmignore"
}

function get_target_branch_by_env() {
    local env=$1
    if [[ "$env" == "dev" ]]; then
        echo "$DEV_HELM_CHART_BRANCH"
    elif [[ "$env" == "prod" ]]; then
        echo "$PROD_HELM_CHART_BRANCH"
    else
        echo "Unknown environment: $env"
        exit 1
    fi
}

# process_helm_values 
## 1. processes the helm values for a given chart. 
## 2. generates the helm template files for dev and prod environments.
## 3. call `process_target_helm_chart` to replace the image tag and adding environment variables.
## 4. commits and pushes the changes to the target repository.
# !NOTE: this function must be run in the directory where the chart is located.
# @Param $1: target_repo_path - The path to the target repository where the helm charts will be processed
# @Param $2: chart_name - The name of the chart to process
function process_helm_values() {
    local target_repo_path=$1
    local chart_name=$2
    echo "Processing directory: $chart_name"

    local dev_values_path="$chart_name/dev-values.yaml"
    local prod_values_path="$chart_name/prod-values.yaml"
    local result_path="$chart_name/result"
    
    local dev_template_file="$chart_name/result/$chart_name-dev.yaml"
    local prod_template_file="$chart_name/result/$chart_name-prod.yaml"
    
    mkdir -p $result_path
    
    echo "EXPORT_TO: $EXPORT_TO"

    if [[ -f "$dev_values_path" && "$EXPORT_TO" == "dev" ]]; then
        pwd
        echo "Processing $dev_values_path"
        helm template $chart_name ./$chart_name -n $DEV_NAMESPACE -f $dev_values_path > $dev_template_file

        process_target_helm_chart "dev" "$dev_template_file" "$target_repo_path" "$chart_name"

        git_add_commit_push "$target_repo_path" "$DEV_HELM_CHART_BRANCH" "Update $chart_name dev values"
    else
        echo "File $dev_values_path does not exist."
    fi

    if [[ -f "$prod_values_path" && "$EXPORT_TO" == "prod" ]]; then
        echo "Processing $prod_values_path"
        helm template $chart_name ./$chart_name -n $PROD_NAMESPACE -f $prod_values_path > $prod_template_file

        process_target_helm_chart "prod" "$prod_template_file" "$target_repo_path" "$chart_name"

        git_add_commit_push "$target_repo_path" "$PROD_HELM_CHART_BRANCH" "Update $chart_name prod values"
    else
        echo "File $prod_values_path does not exist."
    fi
}

function main() {
    # local changed_charts=$(git status --porcelain | awk '{print $2}' | grep --color=never '^templates/' | while read -r file; do

    # if CI_MERGE_REQUEST_DIFF_BASE_SHA
    
    local git_changed_files
    if [ -n "$CI_MERGE_REQUEST_IID" ]; then
        echo "Running in a merge request context."
        git_changed_files=$(git diff --name-only "${CI_MERGE_REQUEST_DIFF_BASE_SHA}" "${CI_COMMIT_SHA}")
    else
        git fetch origin main
        git_changed_files=$(git diff --name-only "origin/main...${CI_COMMIT_SHA}")
    fi
    local changed_charts=$(echo "$git_changed_files" | grep --color=never '^templates/' | while read -r file; do
        relative_path_after_templates=$(echo "$file" | $sed 's|^templates/||')
        if [[ "$relative_path_after_templates" == *"/"* ]]; then
            first_component=$(echo "$relative_path_after_templates" | cut -d'/' -f1)
            directory_in_templates="templates/$first_component"
            if [ -d "$directory_in_templates" ]; then
                echo "$first_component"
            fi
        fi
    done | sort -u | uniq)

    echo "Changed charts:$changed_charts"

    if [[ -z "$changed_charts" ]]; then
        echo "No changed charts found."
        exit 0
    fi

    if [[ -d "$SERVICE_HELM_CHARTS_DIR" ]]; then
        echo "Removing existing $SERVICE_HELM_CHARTS_DIR directory."
        rm -rf "$SERVICE_HELM_CHARTS_DIR"
    fi

    pushd templates
    
    # TODO: should change
    git config --global user.email "<COMMIT-USER-EMAIL>"
    git config --global user.name "<COMMIT-USER-NAME>"

    # Clone the repository
    REPO_URL="https://code.xxx.com/moleculesos/service-helm-repo"
    git_clone_repo "$REPO_URL"
    echo "Cloned repository to: $SERVICE_HELM_CHARTS_DIR"

    for changed_chart in $changed_charts; do
      echo "Changed chart:$changed_chart"
      process_helm_values "$SERVICE_HELM_CHARTS_DIR" "$changed_chart"
    done
    popd
}

main $@
```

`.gitlab-ci.yml` 配置如下：

```yml
variables:
  DEV_NAMESPACE: "mos"
  PROD_NAMESPACE: "prod"
  TARGET_PRODUCTION_BRANCH: "main"
  GIT_PATH: 0

stages:
  - process_dev
  - process_prod
  # - compile

process_dev:
  image: infra/service-helm-ci:0.0.1
  stage: process_dev
  before_script:
    - git fetch origin $CI_MERGE_REQUEST_DIFF_BASE_SHA
  script:
    - echo "Files changed in this Merge Request (compared to base branch at ${CI_MERGE_REQUEST_DIFF_BASE_SHA}):"
    - git diff --name-only "${CI_MERGE_REQUEST_DIFF_BASE_SHA}" "${CI_COMMIT_SHA}"
    - echo "Getting changed directories in the commit range"
    - chmod +x process.sh
    - EXPORT_TO=dev ./process.sh
  rules:
    - changes:
        - templates/**
      when: always
    - if: '$CI_MERGE_REQUEST_IID'

process_prod:
  image: infra/service-helm-ci:0.0.1
  stage: process_prod
  before_script:
    - git fetch origin $CI_MERGE_REQUEST_DIFF_BASE_SHA
  script:
    - echo "Files changed in this Merge Request (compared to base branch at ${CI_MERGE_REQUEST_DIFF_BASE_SHA}):"
    - git diff --name-only "${CI_MERGE_REQUEST_DIFF_BASE_SHA}" "${CI_COMMIT_SHA}"
    - echo "Getting changed directories in the commit range"
    - chmod +x process.sh
    - EXPORT_TO=prod ./process.sh
  rules:
    - changes:
        - templates/**
      when: always
    - if: '$CI_MERGE_REQUEST_IID'
      when: on_success
      allow_failure: false
```



[^1]: [Namespaces created by rancher can't be deleted](https://github.com/rancher/rancher/issues/36450)
[^2]: https://documentation.suse.com/cloudnative/continuous-delivery/v0.12/en/uninstall.html
[^3]: [rancher-cleanup](https://github.com/rancher/rancher-cleanup/blob/main/cleanup.sh#L79)


