package com.sellerctrl.app

import android.content.Context
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.Interceptor
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import java.util.Locale

/**
 * The app's language — the same dictionary as the web (lib/i18n/en.ts, exported to
 * assets/i18n/en.json by `npm run i18n:mobile`), keyed by the Arabic text itself.
 *
 * The phone's language decides: English when the device is set to English, Arabic
 * otherwise. A string with no entry stays Arabic, so nothing can break from a gap.
 * Like the web, a sentence built around values ("الصنف ITM-1 غير موجود") is matched
 * against the entries that have slots ("الصنف {0} غير موجود").
 */
object I18n {
    @Volatile var english: Boolean = false
        private set
    private var exact: Map<String, String> = emptyMap()
    private var buckets: Map<String, List<Pattern>> = emptyMap()

    private class Pattern(val re: Regex, val en: String, val slots: List<String>, val weight: Int)

    private val slot = Regex("""\{(\w+)\}""")
    private val arabic = Regex("[\\u0600-\\u06FF]")

    fun init(context: Context) {
        english = Locale.getDefault().language == "en"
        if (!english) return
        try {
            val text = context.assets.open("i18n/en.json").bufferedReader(Charsets.UTF_8).use { it.readText() }
            val obj = Json.parseToJsonElement(text).jsonObject
            exact = obj.mapValues { it.value.jsonPrimitive.content }
            buckets = buildPatterns(exact)
        } catch (_: Exception) {
            // No dictionary → stay Arabic rather than show half-translated screens.
            english = false
        }
    }

    private fun firstWord(s: String): String = s.trimStart().split(Regex("\\s+"), limit = 2).firstOrNull() ?: ""

    private fun buildPatterns(dict: Map<String, String>): Map<String, List<Pattern>> {
        val out = HashMap<String, MutableList<Pattern>>()
        for ((key, en) in dict) {
            if (!key.contains('{')) continue
            val fixed = key.replace(slot, "")
            if (arabic.findAll(fixed).count() < 4) continue
            val slots = ArrayList<String>()
            val sb = StringBuilder("^")
            var last = 0
            for (m in slot.findAll(key)) {
                sb.append(Regex.escape(key.substring(last, m.range.first)))
                sb.append("([\\s\\S]+?)")
                slots.add(m.groupValues[1])
                last = m.range.last + 1
            }
            sb.append(Regex.escape(key.substring(last))).append("$")
            val prefix = key.substring(0, key.indexOf('{')).trimStart()
            val head = if (prefix.contains(Regex("\\s"))) firstWord(prefix) else ""
            val re = try { Regex(sb.toString()) } catch (_: Exception) { continue }
            out.getOrPut(head) { ArrayList() }.add(Pattern(re, en, slots, fixed.length))
        }
        for (list in out.values) list.sortByDescending { it.weight }
        return out
    }

    private fun matchPattern(s: String): String? {
        if (!arabic.containsMatchIn(s) || s.length > 600) return null
        for (list in listOf(buckets[firstWord(s)], buckets[""])) {
            if (list == null) continue
            for (p in list) {
                val m = p.re.matchEntire(s) ?: continue
                val values = p.slots.mapIndexed { i, name -> name to m.groupValues[i + 1] }.toMap()
                // A value that is itself a label translates too; names and numbers don't.
                return slot.replace(p.en) { r -> values[r.groupValues[1]]?.let { v -> exact[v] ?: v } ?: r.value }
            }
        }
        return null
    }

    fun tr(s: String): String {
        if (!english || s.isEmpty()) return s
        return exact[s] ?: matchPattern(s) ?: s
    }

    /** Translates every Arabic string value in a JSON tree (labels, statuses, messages). */
    fun translateJson(e: JsonElement): JsonElement = when (e) {
        is JsonObject -> JsonObject(e.mapValues { translateJson(it.value) })
        is JsonArray -> JsonArray(e.map { translateJson(it) })
        is JsonPrimitive -> if (e.isString && arabic.containsMatchIn(e.content)) JsonPrimitive(tr(e.content)) else e
        else -> e
    }
}

/** Translate a piece of UI text: `Text(tr("حفظ"))`. A no-op in Arabic. */
fun tr(s: String): String = I18n.tr(s)

/**
 * Server text — report labels, statuses, error messages — arrives in Arabic. In English
 * the JSON is translated on the way in, so every screen shows it translated without
 * each one having to. Streams (SSE) and anything that isn't JSON pass through.
 */
class TranslateInterceptor : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val req = chain.request().newBuilder()
            .header("Accept-Language", if (I18n.english) "en" else "ar")
            .build()
        val res = chain.proceed(req)
        if (!I18n.english) return res
        val body = res.body ?: return res
        val type = body.contentType()
        if (type?.subtype?.contains("json") != true) return res
        val text = body.string()
        val translated = try {
            Json.encodeToString(JsonElement.serializer(), I18n.translateJson(Json.parseToJsonElement(text)))
        } catch (_: Exception) {
            text
        }
        return res.newBuilder().body(translated.toResponseBody(type)).build()
    }
}
