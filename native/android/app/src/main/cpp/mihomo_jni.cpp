#include <jni.h>
#include <dlfcn.h>
#include <stdint.h>
#include <mutex>

namespace {

JavaVM* g_vm = nullptr;
jobject g_vpn_service = nullptr;
std::mutex g_vpn_mutex;

template <typename T>\nT resolve(const char* name) {\n    return reinterpret_cast<T>(dlsym(RTLD_DEFAULT, name));\n}\n
jstring makeString(JNIEnv* env, const char* value) {
    return env->NewStringUTF(value == nullptr ? "" : value);
}

void throwState(JNIEnv* env, const char* message) {
    env->ThrowNew(env->FindClass("java/lang/IllegalStateException"), message);
}

}  // namespace

extern "C" JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM* vm, void*) {
    g_vm = vm;
    return JNI_VERSION_1_6;
}

extern "C" __attribute__((visibility("default"))) int
angelanexus_protect_fd(int fd) {
    std::lock_guard<std::mutex> lock(g_vpn_mutex);
    if (g_vm == nullptr || g_vpn_service == nullptr || fd < 0) {
        return 0;
    }

    JNIEnv* env = nullptr;
    bool attached = false;
    const jint getEnvResult = g_vm->GetEnv(reinterpret_cast<void**>(&env), JNI_VERSION_1_6);
    if (getEnvResult == JNI_EDETACHED) {
        if (g_vm->AttachCurrentThread(&env, nullptr) != JNI_OK) {
            return 0;
        }
        attached = true;
    } else if (getEnvResult != JNI_OK) {
        return 0;
    }

    const jclass clazz = env->GetObjectClass(g_vpn_service);
    const jmethodID protect = clazz == nullptr ? nullptr : env->GetMethodID(clazz, "protect", "(I)Z");
    const jboolean result = protect == nullptr ? JNI_FALSE : env->CallBooleanMethod(g_vpn_service, protect, fd);
    if (env->ExceptionCheck()) {
        env->ExceptionClear();
    }
    if (clazz != nullptr) {
        env->DeleteLocalRef(clazz);
    }
    if (attached) {
        g_vm->DetachCurrentThread();
    }
    return result == JNI_TRUE ? 1 : 0;
}

extern "C" JNIEXPORT jstring JNICALL
Java_app_angelanexus_MihomoJniNativeHost_nativeApplyConfig(
    JNIEnv* env, jobject, jstring configJson) {
    using ApplyConfig = char* (*)(const char*);
    const auto apply = resolve<ApplyConfig>("angelaApplyConfig");
    const auto freeCString = resolve<void (*)(char*)>("freeCString");
    if (apply == nullptr || freeCString == nullptr) {
        throwState(env, "Mihomo config bridge exports are unavailable");
        return nullptr;
    }
    const char* value = configJson == nullptr ? "" : env->GetStringUTFChars(configJson, nullptr);
    char* error = apply(value);
    if (configJson != nullptr) env->ReleaseStringUTFChars(configJson, value);
    jstring result = makeString(env, error);
    freeCString(error);
    return result;
}

extern "C" JNIEXPORT void JNICALL
Java_app_angelanexus_MihomoJniNativeHost_nativeSetVpnService(
    JNIEnv* env, jobject, jobject service) {
    std::lock_guard<std::mutex> lock(g_vpn_mutex);
    if (g_vpn_service != nullptr) {
        env->DeleteGlobalRef(g_vpn_service);
        g_vpn_service = nullptr;
    }
    if (service != nullptr) {
        g_vpn_service = env->NewGlobalRef(service);
    }
}

extern "C" JNIEXPORT jboolean JNICALL
Java_app_angelanexus_MihomoJniNativeHost_nativeHasVpnProtector(
    JNIEnv*, jobject) {
    std::lock_guard<std::mutex> lock(g_vpn_mutex);
    return (g_vm != nullptr && g_vpn_service != nullptr) ? JNI_TRUE : JNI_FALSE;
}

extern "C" JNIEXPORT jboolean JNICALL
Java_app_angelanexus_MihomoJniNativeHost_nativeStartTun(
    JNIEnv* env, jobject, jint fd, jstring stack, jstring address, jstring dns) {
    using StartTun = uint8_t (*)(int, const char*, const char*, const char*);
    const auto start = resolve<StartTun>("startTUN");
    if (start == nullptr) {
        throwState(env, "Mihomo startTUN export is unavailable");
        return JNI_FALSE;
    }

    const char* stackChars = stack == nullptr ? "" : env->GetStringUTFChars(stack, nullptr);
    const char* addressChars = address == nullptr ? "" : env->GetStringUTFChars(address, nullptr);
    const char* dnsChars = dns == nullptr ? "" : env->GetStringUTFChars(dns, nullptr);
    const uint8_t result = start(fd, stackChars, addressChars, dnsChars);

    if (stack != nullptr) env->ReleaseStringUTFChars(stack, stackChars);
    if (address != nullptr) env->ReleaseStringUTFChars(address, addressChars);
    if (dns != nullptr) env->ReleaseStringUTFChars(dns, dnsChars);
    return result != 0 ? JNI_TRUE : JNI_FALSE;
}

extern "C" JNIEXPORT void JNICALL
Java_app_angelanexus_MihomoJniNativeHost_nativeStopTun(JNIEnv* env, jobject) {
    using StopTun = void (*)();
    const auto stop = resolve<StopTun>("stopTun");
    if (stop == nullptr) {
        throwState(env, "Mihomo stopTun export is unavailable");
        return;
    }
    stop();
}

extern "C" JNIEXPORT void JNICALL
Java_app_angelanexus_MihomoJniNativeHost_nativeUpdateDns(
    JNIEnv* env, jobject, jstring dns) {
    using UpdateDns = char* (*)(const char*);
    const auto update = resolve<UpdateDns>("updateDns");
    const auto freeCString = resolve<void (*)(char*)>("freeCString");
    if (update == nullptr || freeCString == nullptr) {
        throwState(env, "Mihomo updateDns export is unavailable");
        return;
    }
    const char* value = dns == nullptr ? "" : env->GetStringUTFChars(dns, nullptr);
    char* error = update(value);
    if (dns != nullptr) env->ReleaseStringUTFChars(dns, value);
    if (error != nullptr && *error != '\0') {
        const jstring message = makeString(env, error);
        const char* chars = env->GetStringUTFChars(message, nullptr);
        throwState(env, chars);
        env->ReleaseStringUTFChars(message, chars);
    }
    freeCString(error);
}

extern "C" JNIEXPORT void JNICALL
Java_app_angelanexus_MihomoJniNativeHost_nativeSetSuspended(
    JNIEnv* env, jobject, jboolean suspended) {
    using Suspend = void (*)(uint8_t);
    const auto suspend = resolve<Suspend>("suspend");
    if (suspend == nullptr) {
        throwState(env, "Mihomo suspend export is unavailable");
        return;
    }
    suspend(suspended == JNI_TRUE ? 1 : 0);
}

extern "C" JNIEXPORT jstring JNICALL
Java_app_angelanexus_MihomoJniNativeHost_nativeInvokeMethod(
    JNIEnv* env, jobject, jstring) {
    throwState(env, "invokeMethod is not yet exposed by the native core boundary");
    return nullptr;
}

extern "C" JNIEXPORT void JNICALL
Java_app_angelanexus_MihomoJniNativeHost_nativeSetEventListener(
    JNIEnv* env, jobject, jobject) {
    throwState(env, "event listener is not yet exposed by the native core boundary");
}

extern "C" JNIEXPORT void JNICALL
Java_app_angelanexus_MihomoJniNativeHost_nativeForceGc(JNIEnv* env, jobject) {
    using ForceGc = void (*)();
    const auto forceGc = resolve<ForceGc>("forceGC");
    if (forceGc == nullptr) {
        throwState(env, "Mihomo forceGC export is unavailable");
        return;
    }
    forceGc();
}

extern "C" JNIEXPORT jstring JNICALL
Java_app_angelanexus_MihomoJniNativeHost_nativeGetTraffic(
    JNIEnv* env, jobject, jboolean onlyStatisticsProxy) {
    using GetTraffic = char* (*)(uint8_t);
    const auto getTraffic = resolve<GetTraffic>("getTraffic");
    const auto freeCString = resolve<void (*)(char*)>("freeCString");
    if (getTraffic == nullptr || freeCString == nullptr) {
        throwState(env, "Mihomo traffic exports are unavailable");
        return nullptr;
    }
    char* value = getTraffic(onlyStatisticsProxy == JNI_TRUE ? 1 : 0);
    jstring result = makeString(env, value);
    freeCString(value);
    return result;
}

extern "C" JNIEXPORT jstring JNICALL
Java_app_angelanexus_MihomoJniNativeHost_nativeGetTotalTraffic(
    JNIEnv* env, jobject, jboolean onlyStatisticsProxy) {
    using GetTraffic = char* (*)(uint8_t);
    const auto getTraffic = resolve<GetTraffic>("getTotalTraffic");
    const auto freeCString = resolve<void (*)(char*)>("freeCString");
    if (getTraffic == nullptr || freeCString == nullptr) {
        throwState(env, "Mihomo total traffic exports are unavailable");
        return nullptr;
    }
    char* value = getTraffic(onlyStatisticsProxy == JNI_TRUE ? 1 : 0);
    jstring result = makeString(env, value);
    freeCString(value);
    return result;
}
