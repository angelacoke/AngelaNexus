plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose") version "2.0.21"
}

import java.util.Base64

val mihomoDistributionApproved =
    providers.gradleProperty("angelanexus.mihomoDistributionApproved").orNull == "true"

android {
    namespace = "app.angelanexus"
    compileSdk = 35

    buildFeatures {
        buildConfig = true
    }

    defaultConfig {
        applicationId = "app.angelanexus"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"
        buildConfigField("boolean", "MIHOMO_DISTRIBUTION_APPROVED", mihomoDistributionApproved.toString())
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        ndk {
            abiFilters += listOf("arm64-v8a", "armeabi-v7a", "x86_64")
        }
    }

    signingConfigs {
        create("release") {
            val keystoreBase64 = System.getenv("ANGELANEXUS_RELEASE_KEYSTORE_B64")
            val keystorePassword = System.getenv("ANGELANEXUS_RELEASE_KEYSTORE_PASSWORD")
            val keyAlias = System.getenv("ANGELANEXUS_RELEASE_KEY_ALIAS")
            val keyPassword = System.getenv("ANGELANEXUS_RELEASE_KEY_PASSWORD")

            if (!keystoreBase64.isNullOrBlank() &&
                !keystorePassword.isNullOrBlank() &&
                !keyAlias.isNullOrBlank() &&
                !keyPassword.isNullOrBlank()
            ) {
                val keystoreFile = layout.buildDirectory.file("signing/release.keystore").get().asFile
                keystoreFile.parentFile.mkdirs()
                if (!keystoreFile.exists()) {
                    keystoreFile.writeBytes(Base64.getDecoder().decode(keystoreBase64))
                }
                storeFile = keystoreFile
                storePassword = keystorePassword
                this.keyAlias = keyAlias
                this.keyPassword = keyPassword
            }
        }
    }

    buildTypes {
        getByName("release") {
            val releaseTaskRequested = gradle.startParameter.taskNames.any {
                it.contains("Release", ignoreCase = true)
            }
            if (releaseTaskRequested) {
                val signingConfigured =
                    !System.getenv("ANGELANEXUS_RELEASE_KEYSTORE_B64").isNullOrBlank() &&
                        !System.getenv("ANGELANEXUS_RELEASE_KEYSTORE_PASSWORD").isNullOrBlank() &&
                        !System.getenv("ANGELANEXUS_RELEASE_KEY_ALIAS").isNullOrBlank() &&
                        !System.getenv("ANGELANEXUS_RELEASE_KEY_PASSWORD").isNullOrBlank()
                check(signingConfigured) {
                    "Release signing is not configured. Set ANGELANEXUS_RELEASE_KEYSTORE_B64, " +
                        "ANGELANEXUS_RELEASE_KEYSTORE_PASSWORD, ANGELANEXUS_RELEASE_KEY_ALIAS, " +
                        "and ANGELANEXUS_RELEASE_KEY_PASSWORD."
                }
                signingConfig = signingConfigs.getByName("release")
            }
        }
    }

    sourceSets["main"].java.srcDirs("../src/main/kotlin")

    externalNativeBuild {
        cmake {
            path = file("src/main/cpp/CMakeLists.txt")
            version = "3.22.1"
        }
    }

    packaging {
        jniLibs {
            keepDebugSymbols.add("**/libclash.so")
        }
    }
}

dependencies {
    implementation(platform("androidx.compose:compose-bom:2024.12.01"))
    implementation(files("libs/libXray.aar"))
    implementation(files("libs/libbox.aar"))
    implementation("androidx.activity:activity-compose:1.10.0")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
    implementation("androidx.javascriptengine:javascriptengine:1.1.1")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    debugImplementation("androidx.compose.ui:ui-tooling")
    testImplementation(kotlin("test"))
    testImplementation("org.json:json:20250517")
    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
}

kotlin {
    jvmToolchain(17)
}
