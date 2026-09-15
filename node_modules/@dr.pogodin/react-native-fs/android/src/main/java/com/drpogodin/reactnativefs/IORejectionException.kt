// TODO: Is it really necessary, can't we rely on
// java.io.IOException instead, which is already used in some places?
package com.drpogodin.reactnativefs

internal class IORejectionException(@JvmField val code: String, message: String?) : Exception(message)
