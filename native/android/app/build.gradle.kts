plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "app.angelanexus"
    compileSdk = 35

    defaultConfig {
        applicationId = "app.angelanexus"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"
    }

    sourceSets["main"].java.srcDirs("../src/main/kotlin")
}

kotlin {
    jvmToolchain(17)
}
