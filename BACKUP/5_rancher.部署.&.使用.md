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
        server_name rancher.moleculemind.com;
        return 301 https://$host$request_uri;
    }
    server {
        listen 443 ssl http2;
        server_name rancher.moleculemind.com;

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



