package app.angelanexus

/**
 * Positive evidence source for Root transparent capabilities.
 *
 * Command presence alone is never treated as proof that a capability works.
 */
interface AndroidRootCapabilityProbe {
    fun tcpTproxy(): Boolean
    fun udpTproxy(): Boolean
    fun dnsInterception(): Boolean
    fun icmpCapture(): Boolean
    fun ipv4PolicyRouting(): Boolean
    fun ipv6PolicyRouting(): Boolean
    fun uidIdentity(): Boolean
    fun processIdentity(): Boolean
    fun atomicRollback(): Boolean
}

object UnverifiedAndroidRootCapabilityProbe : AndroidRootCapabilityProbe {
    override fun tcpTproxy() = false
    override fun udpTproxy() = false
    override fun dnsInterception() = false
    override fun icmpCapture() = false
    override fun ipv4PolicyRouting() = false
    override fun ipv6PolicyRouting() = false
    override fun uidIdentity() = false
    override fun processIdentity() = false
    override fun atomicRollback() = false
}
