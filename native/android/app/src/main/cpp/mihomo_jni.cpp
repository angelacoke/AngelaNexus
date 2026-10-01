#include <jni.h>
#include <dlfcn.h>
#include <stdint.h>

namespace {

template <typename T>
T resolve(const char* name) {
    return reinterpret_cast<T>(dlsym(RTLD_DEFAULT, name));
}

jstring makeString(JNIEnv* env, const char* value) {
    return env->NewStringUTF(value == nullptr ? "" : value);
}

}  // namespace

extern "C" JNIEXPORT jstring JNICALL
Java_app_angelanexus_MihomoJniNativeHost_nativeApplyConfig(
    JNIEnv* env, jobject, jstring configJson) {
    using ApplyConfig = char* (*)(const char*);
    const auto apply = resolve<ApplyConfig>("angelaApplyConfig");
    const auto freeCString = resolve<void (*)(char*)>("freeCString");
    if (apply == nullptr || freeCString == nullptr) {
        env->ThrowNew(env->FindClass("java/lang/IllegalStateException"),
                      "Mihomo config bridge exports are unavailable");
        return nullptr;
    }
    const char* value = configJson == nullptr ? "" : env->GetStringUTFChars(configJson, nullptr);
    char* error = apply(value);
    if (configJson != nullptr) env->ReleaseStringUTFChars(configJson, value);
    jstring result = makeString(env, error);
    freeCString(error);
    return result;
}

extern "C" JNIEXPORT jboolean JNICALL
Java_app_angelanexus_MihomoJniNativeHost_nativeStartTun(
    JNIEnv* env, jobject, jint fd, jstring stack, jstring address, jstring dns) {
    using StartTun = uint8_t (*)(int, const char*, const char*, const char*);
    const auto start = resolve<StartTun>("startTUN");
    if (start == nullptr) {
        env->ThrowNew(env->FindClass("java/lang/IllegalStateException"),
                      "Mihomo startTUN export is unavailable");
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
        env->ThrowNew(env->FindClass("java/lang/IllegalStateException"),
                      "Mihomo stopTun export is unavailable");
        return;
    }
    stop();
}

extern "C" JNIEXPORT void JNICALL
Java_app_angelanexus_MihomoJniNativeHost_nativeUpdateDns(
    JNIEnv* env, jobject, jstring dns) {
    using UpdateDns = void (*)(const char*);
    const auto update = resolve<UpdateDns>("updateDns");
    if (update == nullptr) {
        env->ThrowNew(env->FindClass("java/lang/IllegalStateException"),
                      "Mihomo updateDns export is unavailable");
        return;
    }
    const char* value = dns == nullptr ? "" : env->GetStringUTFChars(dns, nullptr);
    update(value);
    if (dns != nullptr) env->ReleaseStringUTFChars(dns, value);
}

extern "C" JNIEXPORT void JNICALL
Java_app_angelanexus_MihomoJniNativeHost_nativeSetSuspended(
    JNIEnv* env, jobject, jboolean suspended) {
    using Suspend = void (*)(uint8_t);
    const auto suspend = resolve<Suspend>("suspend");
    if (suspend == nullptr) {
        env->ThrowNew(env->FindClass("java/lang/IllegalStateException"),
                      "Mihomo suspend export is unavailable");
        return;
    }
    suspend(suspended == JNI_TRUE ? 1 : 0);
}

extern "C" JNIEXPORT jstring JNICALL
Java_app_angelanexus_MihomoJniNativeHost_nativeInvokeMethod(
    JNIEnv*, jobject, jstring) {
    return nullptr;
}

extern "C" JNIEXPORT void JNICALL
Java_app_angelanexus_MihomoJniNativeHost_nativeSetEventListener(
    JNIEnv*, jobject, jobject) {
}

extern "C" JNIEXPORT void JNICALL
Java_app_angelanexus_MihomoJniNativeHost_nativeForceGc(JNIEnv* env, jobject) {
    using ForceGc = void (*)();
    const auto forceGc = resolve<ForceGc>("forceGC");
    if (forceGc == nullptr) {
        env->ThrowNew(env->FindClass("java/lang/IllegalStateException"),
                      "Mihomo forceGC export is unavailable");
        return;
    }
    forceGc();
}

extern "C" JNIEXPORT jstring JNICALL
Java_app_angelanexus_MihomoJniNativeHost_nativeGetTraffic(
    JNIEnv* env, jobject) {
    using GetTraffic = char* (*)();
    const auto getTraffic = resolve<GetTraffic>("getTraffic");
    const auto freeCString = resolve<void (*)(char*)>("freeCString");
    if (getTraffic == nullptr || freeCString == nullptr) {
        env->ThrowNew(env->FindClass("java/lang/IllegalStateException"),
                      "Mihomo traffic exports are unavailable");
        return nullptr;
    }
    char* value = getTraffic();
    jstring result = makeString(env, value);
    freeCString(value);
    return result;
}

extern "C" JNIEXPORT jstring JNICALL
Java_app_angelanexus_MihomoJniNativeHost_nativeGetTotalTraffic(
    JNIEnv* env, jobject) {
    using GetTraffic = char* (*)();
    const auto getTraffic = resolve<GetTraffic>("getTotalTraffic");
    const auto freeCString = resolve<void (*)(char*)>("freeCString");
    if (getTraffic == nullptr || freeCString == nullptr) {
        env->ThrowNew(env->FindClass("java/lang/IllegalStateException"),
                      "Mihomo total traffic exports are unavailable");
        return nullptr;
    }
    char* value = getTraffic();
    jstring result = makeString(env, value);
    freeCString(value);
    return result;
}
