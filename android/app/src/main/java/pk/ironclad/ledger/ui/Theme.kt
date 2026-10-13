package pk.ironclad.ledger.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

/** The same palette as the web version, so the two never look like different apps. */
object Ink {
    val bg = Color(0xFF141A22)
    val card = Color(0xFF1C2431)
    val card2 = Color(0xFF232D3C)
    val text = Color(0xFFEEF2F7)
    val muted = Color(0xFF8B98A9)
    val line = Color(0xFF2B3644)
    val good = Color(0xFF2FBF71)
    val bad = Color(0xFFFF5F5F)
    val warn = Color(0xFFFFB020)
    val brand = Color(0xFF3D7DFF)
}

fun hexColour(hex: String, fallback: Color = Ink.muted): Color = runCatching {
    val clean = hex.trim().removePrefix("#")
    when (clean.length) {
        6 -> Color(0xFF000000 or clean.toLong(16))
        8 -> Color(clean.toLong(16))
        else -> fallback
    }
}.getOrDefault(fallback)

@Composable
fun LedgerTheme(content: @Composable () -> Unit) {
    @Suppress("UNUSED_EXPRESSION") isSystemInDarkTheme()
    MaterialTheme(
        colorScheme = darkColorScheme(
            primary = Ink.brand,
            background = Ink.bg,
            surface = Ink.card,
            onPrimary = Color.White,
            onBackground = Ink.text,
            onSurface = Ink.text,
            error = Ink.bad,
        ),
        content = content,
    )
}
