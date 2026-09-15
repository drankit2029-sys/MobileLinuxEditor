// Encapsulates error reporting to RN.
package com.drpogodin.reactnativefs

import com.facebook.react.bridge.Promise

enum class Errors(val message: String) {
    NOT_IMPLEMENTED("This method is not implemented for Android"),
    OPERATION_FAILED("Operation failed");

    val error: Error
        get() = Error(message)

    fun reject(promise: Promise?) {
        promise?.reject(this.toString(), message, error)
    }

    fun reject(promise: Promise?, details: String?) {
        if (promise != null) {
            var message = message
            if (details != null) message += ": $details"
            promise.reject(this.toString(), message, error)
        }
    }

    override fun toString(): String {
        return "$LOGTAG:$name"
    }

    companion object {
        const val LOGTAG = "RNFS"
    }
}
