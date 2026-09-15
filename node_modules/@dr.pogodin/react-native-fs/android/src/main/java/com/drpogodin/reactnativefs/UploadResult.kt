package com.drpogodin.reactnativefs

import com.facebook.react.bridge.WritableMap

class UploadResult {
    @JvmField
    var statusCode = 0
    @JvmField
    var headers: WritableMap? = null
    @JvmField
    var exception: Exception? = null
    @JvmField
    var body: String? = null
}
