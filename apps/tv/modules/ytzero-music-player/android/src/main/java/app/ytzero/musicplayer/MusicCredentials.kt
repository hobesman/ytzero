package app.ytzero.musicplayer

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * The server and sign-in music last played with, kept so Android Auto can
 * browse and play while the app itself is closed. The profile's token is
 * encrypted with a key that never leaves the Android keystore; the file is
 * this app's private storage and is left out of Android backups by the key.
 */
class MusicCredentials(context: Context) {
  private val prefs = context.applicationContext.getSharedPreferences("ytzero_music_car", Context.MODE_PRIVATE)

  /** The server's address, such as `https://tube.example`, or null before music first played. */
  fun instance(): String? = prefs.getString(KEY_INSTANCE, null)

  fun setInstance(url: String) {
    if (instance() != url) prefs.edit().putString(KEY_INSTANCE, url).apply()
  }

  /** The bearer token, or null when the server needs none or it could not be read. */
  fun token(): String? = prefs.getString(KEY_TOKEN, null)?.let(::decrypt)

  fun setToken(token: String?) {
    val sealed = token?.takeIf { it.isNotEmpty() }?.let(::encrypt)
    prefs.edit().apply { if (sealed == null) remove(KEY_TOKEN) else putString(KEY_TOKEN, sealed) }.apply()
  }

  /** The server turned the token down: the car asks for the phone until music plays there again. */
  fun forget() = prefs.edit().remove(KEY_TOKEN).remove(KEY_INSTANCE).apply()

  private fun key(): SecretKey {
    val store = KeyStore.getInstance(KEYSTORE).apply { load(null) }
    (store.getKey(ALIAS, null) as? SecretKey)?.let { return it }
    val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
    generator.init(KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
      .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
      .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
      .build())
    return generator.generateKey()
  }

  private fun encrypt(text: String): String? = try {
    val cipher = Cipher.getInstance(TRANSFORMATION).apply { init(Cipher.ENCRYPT_MODE, key()) }
    val sealed = cipher.iv + cipher.doFinal(text.toByteArray(Charsets.UTF_8))
    Base64.encodeToString(sealed, Base64.NO_WRAP)
  } catch (_: Exception) { null }

  private fun decrypt(stored: String): String? = try {
    val sealed = Base64.decode(stored, Base64.NO_WRAP)
    val cipher = Cipher.getInstance(TRANSFORMATION)
    cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, sealed, 0, IV_BYTES))
    String(cipher.doFinal(sealed, IV_BYTES, sealed.size - IV_BYTES), Charsets.UTF_8)
  } catch (_: Exception) { null }

  private companion object {
    const val KEYSTORE = "AndroidKeyStore"
    const val ALIAS = "ytzero_music_car"
    const val TRANSFORMATION = "AES/GCM/NoPadding"
    const val IV_BYTES = 12
    const val KEY_INSTANCE = "instance"
    const val KEY_TOKEN = "token"
  }
}
