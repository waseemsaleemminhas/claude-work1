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
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import kotlin.math.atan2
import kotlin.math.hypot
import java.time.LocalDate
import java.time.format.TextStyle
import java.util.Locale

/** A slice of the ring: how much, in what colour, and what it stands for. */
data class Slice(
    val value: Long,
    val colour: Color,
    val name: String = "",
    val icon: String = "",
)

@Composable
fun Ring(
    slices: List<Slice>,
    total: Long,
    modifier: Modifier = Modifier,
    picked: String = "",
    onPick: (String) -> Unit = {},
    centre: @Composable () -> Unit,
) {
    Box(modifier = modifier.aspectRatio(1f), contentAlignment = Alignment.Center) {
        Canvas(
            Modifier.fillMaxSize().pointerInput(slices, total) {
                // A phone has no hover, so a tap is how you ask what a slice is.
                detectTapGestures { at ->
                    val wide = size.width.toFloat()
                    val tall = size.height.toFloat()
                    val middle = Offset(wide / 2f, tall / 2f)
                    val reach = minOf(wide, tall) / 2f
                    val away = hypot(
                        (at.x - middle.x).toDouble(), (at.y - middle.y).toDouble(),
                    ).toFloat()
                    if (away > reach * 0.52f && away <= reach) {
                        val name = sliceAt(slices, total, at, middle)
                        onPick(if (name == picked) "" else name)
                    } else if (away <= reach * 0.52f) {
                        onPick("")
                    }
                }
            },
        ) {
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
                        val chosen = picked.isNotBlank() && slice.name == picked
                        val fat = if (chosen) thickness * 1.45f else thickness
                        val fatInset = (size.minDimension - (size.minDimension - fat)) / 2
                        drawArc(
                            color = if (picked.isBlank() || chosen) slice.colour
                                else slice.colour.copy(alpha = 0.3f),
                            startAngle = start,
                            sweepAngle = (sweep - if (slices.size > 1) 1.2f else 0f).coerceAtLeast(0.6f),
                            useCenter = false,
                            topLeft = Offset(fatInset, fatInset),
                            size = Size(size.width - fat, size.height - fat),
                            style = Stroke(width = fat),
                        )
                        start += sweep
                    }
                }
            }
        }
        Column(horizontalAlignment = Alignment.CenterHorizontally) { centre() }
    }
}

/** Which slice a tap landed on, by the angle from twelve o'clock. */
internal fun sliceAt(slices: List<Slice>, total: Long, at: Offset, middle: Offset): String {
    if (total <= 0) return ""
    var degrees = Math.toDegrees(
        atan2((at.y - middle.y).toDouble(), (at.x - middle.x).toDouble()),
    ).toFloat() + 90f
    while (degrees < 0f) degrees += 360f
    while (degrees >= 360f) degrees -= 360f
    var start = 0f
    slices.forEach { slice ->
        val sweep = 360f * (slice.value.toFloat() / total.toFloat())
        if (degrees >= start && degrees < start + sweep) return slice.name
        start += sweep
    }
    return slices.lastOrNull()?.name.orEmpty()
}

/** How many categories are spelled out before the rest are a tap on the ring away. */
const val RANKED = 6

/**
 * The slices spelled out, each row filled to the width of what it cost against
 * the heaviest one. Six bars can be read at a glance where six arcs cannot:
 * the ring says what shape the month is, these say what the numbers are. The
 * fill is the row itself, so the bars cost no height over a plain list.
 */
@Composable
fun RingLabels(
    slices: List<Slice>,
    total: Long,
    money: (Long) -> String,
    picked: String,
    onPick: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    if (slices.isEmpty() || total <= 0) return
    val shown = slices.take(RANKED)
    val heaviest = shown.maxOf { it.value }.coerceAtLeast(1L)
    Column(modifier.fillMaxWidth().padding(top = 8.dp)) {
        shown.forEach { slice ->
            val share = (slice.value * 100.0 / total).let { if (it < 1) "<1" else it.toInt().toString() }
            val chosen = slice.name == picked
            Box(
                Modifier.fillMaxWidth().padding(bottom = 3.dp).height(28.dp)
                    .clip(RoundedCornerShape(8.dp))
                    .background(Ink.card)
                    .clickable { onPick(if (chosen) "" else slice.name) },
            ) {
                Box(
                    Modifier.fillMaxHeight()
                        .fillMaxWidth((slice.value.toFloat() / heaviest.toFloat()).coerceIn(0.015f, 1f))
                        .background(slice.colour.copy(alpha = if (chosen) 0.38f else 0.22f)),
                )
                Row(
                    Modifier.fillMaxSize().padding(horizontal = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(Modifier.size(8.dp).clip(CircleShape).background(slice.colour))
                    Text(
                        (if (slice.icon.isNotBlank()) slice.icon + "  " else "") + slice.name,
                        fontSize = 12.sp, color = if (chosen) Ink.text else Ink.muted,
                        fontWeight = if (chosen) FontWeight.SemiBold else FontWeight.Normal,
                        maxLines = 1, overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f).padding(start = 8.dp),
                    )
                    Text(share + "%", fontSize = 11.sp, color = Ink.muted,
                        modifier = Modifier.padding(end = 8.dp))
                    Text(money(slice.value), fontSize = 12.sp, fontWeight = FontWeight.SemiBold,
                        color = if (chosen) Ink.text else Ink.muted)
                }
            }
        }
        if (slices.size > RANKED) {
            Text(
                "and " + (slices.size - RANKED) + " more — tap the ring",
                fontSize = 11.sp, color = Ink.muted,
                modifier = Modifier.padding(start = 8.dp, top = 2.dp),
            )
        }
    }
}

/**
 * Handing cash over, offered in the gap between the two people it moves
 * between. One of us takes the money in and the other spends it, so cash
 * crossing from one pocket to the other is the second commonest thing in this
 * book — and until now it was buried behind Move money on another screen.
 */
@Composable
fun HandoverPill(to: String, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Row(
        modifier
            .clip(CircleShape)
            .background(Ink.card2)
            .border(BorderStroke(1.dp, Ink.brand.copy(alpha = 0.45f)), CircleShape)
            .clickable(onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text("⇄", fontSize = 13.sp, color = Ink.brand)
        Text(
            if (to.isBlank()) "Hand cash over" else "Hand cash to " + to,
            fontSize = 12.sp, color = Ink.text, fontWeight = FontWeight.SemiBold,
            maxLines = 1, overflow = TextOverflow.Ellipsis,
            modifier = Modifier.padding(start = 7.dp),
        )
    }
}

/**
 * Money in against money out, drawn to scale. Sits at the foot of Records so
 * the two numbers that matter are there whatever you have scrolled to.
 */
@Composable
fun InOutBar(inMinor: Long, outMinor: Long, money: (Long) -> String, modifier: Modifier = Modifier) {
    val most = maxOf(inMinor, outMinor, 1L).toFloat()
    Column(
        modifier.fillMaxWidth()
            .clip(RoundedCornerShape(18.dp))
            .background(
                Brush.verticalGradient(listOf(Ink.card2, Ink.card)),
            )
            .border(BorderStroke(1.dp, Ink.line), RoundedCornerShape(18.dp))
            .padding(horizontal = 14.dp, vertical = 12.dp),
    ) {
        listOf(
            Triple("PKR IN", inMinor, Ink.good),
            Triple("PKR OUT", outMinor, Ink.bad),
        ).forEach { (label, amount, colour) ->
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(vertical = 3.dp)) {
                Text(label, fontSize = 10.sp, fontWeight = FontWeight.Bold, color = colour,
                    modifier = Modifier.width(58.dp))
                Box(
                    Modifier.weight(1f).height(16.dp).clip(RoundedCornerShape(5.dp))
                        .background(Ink.card2),
                ) {
                    Box(
                        Modifier.fillMaxHeight()
                            .fillMaxWidth((amount.toFloat() / most).coerceIn(0f, 1f))
                            .clip(RoundedCornerShape(5.dp))
                            .background(colour),
                    )
                }
                Text(
                    money(amount), fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = Ink.text,
                    maxLines = 1, modifier = Modifier.padding(start = 8.dp).widthIn(min = 64.dp),
                    textAlign = TextAlign.End,
                )
            }
        }
        val left = inMinor - outMinor
        Text(
            (if (left >= 0) "Left over " else "Short by ") + money(kotlin.math.abs(left)),
            fontSize = 11.sp, color = if (left < 0) Ink.bad else Ink.muted,
            modifier = Modifier.padding(top = 4.dp, start = 58.dp),
        )
    }
}

/** Green while there is room, amber as it runs out, red once it is past. */
fun budgetColour(share: Float): Color = when {
    share > 1f -> Ink.bad
    share >= 0.8f -> Ink.warn
    else -> Ink.good
}

/** How much of a budget has gone, drawn as a line you can read at a glance. */
@Composable
fun BudgetBar(share: Float, modifier: Modifier = Modifier, thickness: Int = 6) {
    Box(
        modifier
            .fillMaxWidth()
            .height(thickness.dp)
            .clip(RoundedCornerShape((thickness / 2).dp))
            .background(Ink.card2),
    ) {
        Box(
            Modifier.fillMaxHeight()
                .fillMaxWidth(share.coerceIn(0f, 1f))
                .clip(RoundedCornerShape((thickness / 2).dp))
                .background(budgetColour(share)),
        )
        if (share > 1f) {
            // past the limit: the whole line goes red, so it cannot be missed
            Box(Modifier.fillMaxSize().clip(RoundedCornerShape((thickness / 2).dp)).background(Ink.bad))
        }
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

/**
 * The card a screen opens with: a wash of colour behind a big number, so the
 * figure that matters is the first thing the eye lands on.
 */
@Composable
fun HeroCard(
    label: String,
    value: String,
    valueColour: Color = Ink.text,
    accent: Color = Ink.brand,
    footnote: String = "",
    modifier: Modifier = Modifier,
    trailing: @Composable (() -> Unit)? = null,
) {
    Column(
        modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(20.dp))
            .background(
                Brush.verticalGradient(
                    listOf(accent.copy(alpha = 0.26f), Ink.card),
                ),
            )
            .border(BorderStroke(1.dp, accent.copy(alpha = 0.35f)), RoundedCornerShape(20.dp))
            .padding(horizontal = 16.dp, vertical = 14.dp),
    ) {
        Text(label.uppercase(), fontSize = 10.sp, letterSpacing = 1.sp, color = Ink.muted)
        Row(Modifier.fillMaxWidth().padding(top = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(
                value, fontSize = 28.sp, fontWeight = FontWeight.Bold, color = valueColour,
                maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f),
            )
            trailing?.invoke()
        }
        if (footnote.isNotBlank()) {
            Text(footnote, fontSize = 11.sp, color = Ink.muted, modifier = Modifier.padding(top = 4.dp))
        }
    }
}

/** One person's money, small enough to sit beside the others. */
@Composable
fun BalanceTile(
    who: String,
    what: String,
    amount: String,
    accent: Color,
    modifier: Modifier = Modifier,
    onClick: (() -> Unit)? = null,
) {
    Column(
        modifier
            .clip(RoundedCornerShape(16.dp))
            .background(Brush.verticalGradient(listOf(accent.copy(alpha = 0.2f), Ink.card)))
            .border(BorderStroke(1.dp, accent.copy(alpha = 0.3f)), RoundedCornerShape(16.dp))
            .let { if (onClick != null) it.clickable(onClick = onClick) else it }
            .padding(horizontal = 12.dp, vertical = 10.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier.size(22.dp).clip(CircleShape).background(accent.copy(alpha = 0.3f)),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    who.take(1).uppercase(), fontSize = 11.sp,
                    fontWeight = FontWeight.Bold, color = Ink.text,
                )
            }
            Text(
                who, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = Ink.text,
                maxLines = 1, overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(start = 7.dp),
            )
        }
        Text(
            amount, fontSize = 17.sp, fontWeight = FontWeight.Bold,
            color = if (amount.startsWith("-")) Ink.bad else Ink.text,
            maxLines = 1, overflow = TextOverflow.Ellipsis,
            modifier = Modifier.padding(top = 6.dp),
        )
        if (what.isNotBlank()) {
            Text(what, fontSize = 10.sp, color = Ink.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

/** A small button that lives inside a card. */
@Composable
fun InlineAction(text: String, colour: Color = Ink.brand, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Box(
        modifier
            .clip(RoundedCornerShape(10.dp))
            .background(colour.copy(alpha = 0.16f))
            .border(BorderStroke(1.dp, colour.copy(alpha = 0.45f)), RoundedCornerShape(10.dp))
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 8.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(text, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = colour, maxLines = 1)
    }
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
            .clip(RoundedCornerShape(16.dp))
            .background(Ink.card)
            .border(BorderStroke(1.dp, if (warn) Ink.warn.copy(alpha = 0.5f) else Ink.line), RoundedCornerShape(16.dp))
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
        modifier = Modifier.fillMaxWidth().padding(top = 14.dp, bottom = 8.dp, start = 4.dp, end = 4.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.weight(1f)) {
            Box(Modifier.size(3.dp, 14.dp).clip(RoundedCornerShape(2.dp)).background(Ink.brand))
            Text(
                left, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = Ink.text,
                modifier = Modifier.padding(start = 8.dp),
            )
        }
        if (right.isNotBlank()) {
            Text(right, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = Ink.muted)
        }
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
    /** "October" — what the budget card puts above the bars. */
    fun monthName(day: LocalDate): String =
        day.month.getDisplayName(TextStyle.FULL, Locale.UK)

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
