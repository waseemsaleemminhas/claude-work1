package pk.ironclad.ledger.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.Canvas
import java.time.LocalDate
import java.time.format.TextStyle
import java.util.Locale

/** A slice of the ring: how much, and in what colour. */
data class Slice(val value: Long, val colour: Color)

@Composable
fun Ring(slices: List<Slice>, total: Long, modifier: Modifier = Modifier, centre: @Composable () -> Unit) {
    Box(modifier = modifier.aspectRatio(1f), contentAlignment = Alignment.Center) {
        Canvas(Modifier.fillMaxSize()) {
            val thickness = size.minDimension * 0.14f
            val inset = thickness / 2
            val arcSize = Size(size.width - thickness, size.height - thickness)
            drawArc(
                color = Ink.card2, startAngle = 0f, sweepAngle = 360f, useCenter = false,
                topLeft = Offset(inset, inset), size = arcSize, style = Stroke(width = thickness),
            )
            if (total > 0) {
                var start = -90f
                slices.forEach { slice ->
                    val sweep = 360f * (slice.value.toFloat() / total.toFloat())
                    if (sweep > 0f) {
                        drawArc(
                            color = slice.colour, startAngle = start,
                            sweepAngle = (sweep - if (slices.size > 1) 1.2f else 0f).coerceAtLeast(0.6f),
                            useCenter = false, topLeft = Offset(inset, inset), size = arcSize,
                            style = Stroke(width = thickness),
                        )
                        start += sweep
                    }
                }
            }
        }
        Column(horizontalAlignment = Alignment.CenterHorizontally) { centre() }
    }
}

@Composable
fun Chip(text: String, selected: Boolean = false, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Box(
        modifier = modifier
            .clip(CircleShape)
            .background(if (selected) Ink.brand.copy(alpha = 0.18f) else Ink.card2)
            .border(BorderStroke(1.dp, if (selected) Ink.brand else Ink.line), CircleShape)
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 8.dp),
    ) {
        Text(text, fontSize = 13.sp, color = Ink.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
fun Card(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    Box(
        modifier = modifier
            .clip(RoundedCornerShape(14.dp))
            .background(Ink.card)
            .border(BorderStroke(1.dp, Ink.line), RoundedCornerShape(14.dp))
            .padding(12.dp),
    ) { content() }
}

/** The list row used everywhere: icon bubble, two lines of words, an amount. */
@Composable
fun ListRow(
    icon: String,
    colour: Color,
    title: String,
    subtitle: String,
    amount: String = "",
    amountColour: Color = Ink.text,
    note: String = "",
    warn: Boolean = false,
    onClick: (() -> Unit)? = null,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(bottom = 8.dp)
            .clip(RoundedCornerShape(14.dp))
            .background(Ink.card)
            .border(BorderStroke(1.dp, if (warn) Ink.warn.copy(alpha = 0.5f) else Ink.line), RoundedCornerShape(14.dp))
            .let { if (onClick != null) it.clickable(onClick = onClick) else it }
            .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Box(
            modifier = Modifier.size(34.dp).clip(CircleShape).background(colour.copy(alpha = 0.18f)),
            contentAlignment = Alignment.Center,
        ) { Text(icon, fontSize = 17.sp) }
        Column(modifier = Modifier.weight(1f)) {
            Text(title, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = Ink.text,
                maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (subtitle.isNotBlank()) {
                Text(subtitle, fontSize = 12.sp, color = Ink.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        if (amount.isNotBlank()) {
            Column(horizontalAlignment = Alignment.End) {
                Text(amount, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = amountColour)
                if (note.isNotBlank()) Text(note, fontSize = 10.sp, color = Ink.muted)
            }
        }
    }
}

@Composable
fun SectionLabel(left: String, right: String = "") {
    Row(
        modifier = Modifier.fillMaxWidth().padding(top = 10.dp, bottom = 6.dp, start = 4.dp, end = 4.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(left, fontSize = 12.sp, color = Ink.muted)
        if (right.isNotBlank()) Text(right, fontSize = 12.sp, color = Ink.muted)
    }
}

@Composable
fun Empty(text: String) {
    Box(Modifier.fillMaxWidth().padding(28.dp), contentAlignment = Alignment.Center) {
        Text(text, color = Ink.muted, fontSize = 14.sp, textAlign = TextAlign.Center)
    }
}

/** Which days the screen is showing, and what to call them. */
object Period {
    fun range(unit: String, anchor: LocalDate): Pair<LocalDate, LocalDate> = when (unit) {
        "day" -> anchor to anchor
        "week" -> {
            val start = anchor.minusDays(((anchor.dayOfWeek.value + 6) % 7).toLong())
            start to start.plusDays(6)
        }
        "year" -> anchor.withDayOfYear(1) to anchor.withDayOfYear(anchor.lengthOfYear())
        "all" -> LocalDate.of(1970, 1, 1) to LocalDate.of(2999, 12, 31)
        else -> anchor.withDayOfMonth(1) to anchor.withDayOfMonth(anchor.lengthOfMonth())
    }

    fun label(unit: String, anchor: LocalDate, today: LocalDate): String {
        val (from, to) = range(unit, anchor)
        return when (unit) {
            "day" -> dayLabel(from, today)
            "week" -> "${from.dayOfMonth} ${month(from)} – ${to.dayOfMonth} ${month(to)}"
            "year" -> from.year.toString()
            "all" -> "All time"
            else -> anchor.month.getDisplayName(TextStyle.FULL, Locale.UK) + " " + anchor.year
        }
    }

    fun dayLabel(date: LocalDate, today: LocalDate): String = when (date) {
        today -> "Today"
        today.minusDays(1) -> "Yesterday"
        else -> date.dayOfWeek.getDisplayName(TextStyle.FULL, Locale.UK) + ", " +
            date.dayOfMonth + " " + month(date) + if (date.year == today.year) "" else " ${date.year}"
    }

    private fun month(date: LocalDate) = date.month.getDisplayName(TextStyle.SHORT, Locale.UK)
}
