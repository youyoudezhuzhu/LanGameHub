#include <jni.h>
#include <fcntl.h>
#include <stdlib.h>
#include <unistd.h>

extern int node_start(int count, char **arguments) __asm__("_ZN4node5StartEiPPc");

JNIEXPORT jint JNICALL Java_net_langamehub_HubService_launchNode(
    JNIEnv *env, jclass type, jstring file, jstring assets, jstring port, jstring secret, jstring log, jboolean verbose
) {
    (void)type;
    const char *file_path = (*env)->GetStringUTFChars(env, file, 0);
    const char *asset_path = (*env)->GetStringUTFChars(env, assets, 0);
    const char *port_text = (*env)->GetStringUTFChars(env, port, 0);
    const char *secret_text = (*env)->GetStringUTFChars(env, secret, 0);
    const char *log_path = (*env)->GetStringUTFChars(env, log, 0);
    int output = open(log_path, O_CREAT | O_TRUNC | O_WRONLY | O_CLOEXEC, 0600);
    if (output >= 0) {
        dup2(output, STDOUT_FILENO);
        dup2(output, STDERR_FILENO);
        close(output);
    }
    setenv("STATIC_DIR", asset_path, 1);
    setenv("HOST", "0.0.0.0", 1);
    setenv("PORT", port_text, 1);
    setenv("LAN_HUB", "1", 1);
    setenv("LAN_HUB_SECRET", secret_text, 1);
    setenv("NODE_ENV", "production", 1);
    setenv("LAN_HUB_VERBOSE", verbose ? "1" : "0", 1);
    char name[] = "lan-game-hub";
    char *args[] = { name, (char *)file_path, 0 };
    const int result = node_start(2, args);
    (*env)->ReleaseStringUTFChars(env, file, file_path);
    (*env)->ReleaseStringUTFChars(env, assets, asset_path);
    (*env)->ReleaseStringUTFChars(env, port, port_text);
    (*env)->ReleaseStringUTFChars(env, secret, secret_text);
    (*env)->ReleaseStringUTFChars(env, log, log_path);
    return result;
}
