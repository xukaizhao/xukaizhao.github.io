清华春日赏花地图｜腾讯底图版
将本目录内容放到 tsinghua-spring-map 仓库根目录，Settings → Pages 选择实际分支和 / (root)。
底图使用腾讯 JavaScript API GL，不再使用 OSM 或 Leaflet。
src/config.js 的 TENCENT_MAP_KEY 已填入网站所有者提供的腾讯位置服务 Key，发布时保留。
如果配置了访问来源限制，请将 xukaizhao.github.io 和本地调试域名加入允许范围。
腾讯 SDK 不支持 file://。请通过本地 HTTP 预览服务或发布后的 HTTPS 地址访问。
ENABLE_TENCENT_WEB_SERVICES 默认 false：使用腾讯底图展示点位与路线连线，距离时长为估算。
如以后启用真实步行导航和地点检索，先确认相应 WebService 权限再改为 true。
没有后端或云端 AI；花况是项目示例，共建记录仅保存在当前浏览器。
原项目：https://github.com/xukaizhao/tsinghua-spring-map
项目故事：https://blog.csdn.net/weixin_44792382/article/details/160585879
腾讯官方接入：https://lbs.qq.com/webApi/javascriptGL/glGuide/glBasic
