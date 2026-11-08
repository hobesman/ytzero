package app.ytzero.sessioncookie

import android.webkit.CookieManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * React Native's Android image pipeline drops per-image request headers, so
 * thumbnails sent without the bearer token got 401 from the instance. Fetch
 * and Fresco share the system cookie store, and the server also accepts the
 * session as its `ytzero_session` cookie, so the app stores it there.
 */
class YtZeroSessionCookieModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("YtZeroSessionCookie")

    AsyncFunction("setSessionCookie") { url: String, token: String? ->
      val manager = CookieManager.getInstance()
      val secure = if (url.startsWith("https://")) "; Secure" else ""
      val cookie = if (token.isNullOrEmpty()) {
        "ytzero_session=; Path=/; Max-Age=0$secure"
      } else {
        "ytzero_session=$token; Path=/; HttpOnly; SameSite=Lax$secure"
      }
      manager.setCookie(url, cookie)
      manager.flush()
      true
    }
  }
}
