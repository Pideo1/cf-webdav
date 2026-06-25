# 说明

pcloud-webdav-proxy.js、teracloud-webdav-proxy.js 分别对应的反代对象  欧洲成立的[pcloud](https://www.pcloud.com/)和 日本成立的[infinicloud/teracloud](https://infini-cloud.net/)，

## infinicloud
>[!important]
>注意：infinicloud的webdav服务需要修改 这一行 https://github.com/Pideo1/cf-webdav/blob/a8770df3d2c0e22546486fc393ea0b9132374c73/teracloud-webdav-proxy.js#L14 
>
>例子：
>你在[inificloud后台](https://infini-cloud.net/en/modules/mypage/usage/) 勾选`Turn on Apps Connection `，然后获取到地址是 `https://example.teracloud.jp/dav`，
>代码中的`https://xxx.teracloud.jp`替换为你的`https://example.teracloud.jp`，
>不带`/dav`，

使用webdav客户端请求的 时候，地址改成 `https://your.workers.dev/dav` ，用户名就是 `Connection ID`里面的值，比如我这里的`Mi23`，密码是`Apps Password`里面的值，最开始用的时候，要点一下`issue`，应该会有一个弹窗，说`xxxxx`是你的密码
<img width="755" height="343" alt="图片" src="https://github.com/user-attachments/assets/85b13a32-7f75-49db-91c2-bb7a6d25e632" />

## pcloud
>[!important]
>注意：pcloud的webdav服务需要选择地区，https://github.com/Pideo1/cf-webdav/blob/a8770df3d2c0e22546486fc393ea0b9132374c73/pcloud-webdav-proxy.js#L1-L2
>
>你注册的时候，选的是美国地区，就删除掉第二行最开始得两条斜杠；反之，选择欧洲地区，就删除掉第一行最开始得两条斜杠，两个二选一，。
>
>部署后，webdav客户端 地址填写 `https://your.workers.dev/`,用户名为注册时填写的邮箱，密码就是注册时设定的密码（所以注册的时候密码最好不要填写太多符号，大小写字母、数字多一点就可以了）
