# 编译签名密钥

`langamehub.jks` 是这个 App 的**固定签名密钥**，编译时默认使用它。
放进仓库是为了让每次编译出来的 APK 签名一致 —— 这样新版本可以直接覆盖
安装旧版本，不需要先卸载。

| 项 | 值 |
| --- | --- |
| 文件 | `android/keystore/langamehub.jks` |
| 类型 | PKCS12 |
| 别名 | `androiddebugkey` |
| 库口令 / 密钥口令 | `android` |
| 证书 SHA-256 | `62:ED:A7:74:AB:79:24:33:DA:E1:79:3A:05:BE:B1:02:8C:C2:F1:E9:E6:26:2A:91:78:11:46:A1:E0:53:23:52` |

## 为什么不能换新的

Android 只允许**签名相同**的 APK 覆盖安装。换密钥就必须先卸载旧版，
用户的对局存档和设置都会丢。所以这个文件要一直带着，不要重新生成。

## 怎么用

编译脚本默认就用它，不用额外配置：

```bash
./scripts/build-apk.sh
```

需要换别的密钥时用环境变量覆盖：

```bash
HUB_KEYSTORE=/path/to/my.jks \
HUB_KEYSTORE_PASSWORD=xxx \
HUB_KEY_ALIAS=xxx \
HUB_KEY_PASSWORD=yyy \
./scripts/build-apk.sh
```

Gradle 构建（`cd android && ./gradlew assembleDebug`）也读同一个文件。

## 安全说明

这是一个**自用局域网工具**，密钥口令是公开的 `android`，和 Android 默认
调试密钥同一级别。把它放进公开仓库意味着别人也能签出同包名的 APK，
所以：

- 这个 App 不要装到你不信任的来源之外；
- 如果要正式分发，应该换成自己保管的私有密钥（并接受老用户需要卸载一次），
  或者只在本地/私有 CI 里注入密钥。

现在这样做是**为了让更新可以平顺覆盖安装**，属于有意识的取舍。
