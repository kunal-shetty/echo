package app.echo.finance.agent;

import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Locale;

/**
 * Decides whether recognised speech contains the agent's name.
 *
 * The offline recogniser has a fixed vocabulary, so a made-up name like
 * "Kunal" comes out as the nearest real words ("cue nal", "canal"). Instead
 * of asking for an exact word we fold both sides to a rough phonetic key and
 * compare runs of one to three consecutive heard words against it, allowing
 * a small edit distance. Aliases recorded during the "teach" step cover
 * names the recogniser hears in a consistently different way.
 */
public final class WakeWordMatcher {

    private static final int MAX_WINDOW_WORDS = 3;

    private final List<String> keys = new ArrayList<>();

    public WakeWordMatcher(String name, Collection<String> aliases) {
        addKey(name);
        if (aliases != null) {
            for (String alias : aliases) addKey(alias);
        }
    }

    private void addKey(String phrase) {
        String key = phoneticKey(phrase);
        if (key.length() >= 2 && !keys.contains(key)) keys.add(key);
    }

    /** True when any run of consecutive words in {@code heard} sounds like the name. */
    public boolean matches(String heard) {
        if (heard == null || keys.isEmpty()) return false;
        String[] words = heard.toLowerCase(Locale.ROOT).trim().split("\\s+");
        for (int start = 0; start < words.length; start++) {
            StringBuilder joined = new StringBuilder();
            for (int size = 1; size <= MAX_WINDOW_WORDS && start + size <= words.length; size++) {
                joined.append(words[start + size - 1]);
                String candidate = phoneticKey(joined.toString());
                if (candidate.isEmpty()) continue;
                for (String key : keys) {
                    if (closeEnough(candidate, key)) return true;
                }
            }
        }
        return false;
    }

    static boolean closeEnough(String candidate, String key) {
        int allowed = key.length() <= 3 ? 0 : key.length() <= 6 ? 1 : 2;
        if (Math.abs(candidate.length() - key.length()) > allowed) return false;
        return editDistance(candidate, key) <= allowed;
    }

    /**
     * A rough sound-alike key: lowercase letters only, common spellings of the
     * same sound and voiced/unvoiced consonant pairs merged, and doubled
     * letters collapsed.
     */
    static String phoneticKey(String text) {
        if (text == null) return "";
        String s = text.toLowerCase(Locale.ROOT).replaceAll("[^a-z]", "");
        s = s.replace("ph", "f")
            .replace("ck", "k")
            .replace("qu", "kw")
            .replace("ee", "i")
            .replace("ea", "i")
            .replace("oo", "u")
            .replace("ou", "u")
            .replace("c", "k")
            .replace("q", "k")
            .replace("z", "s")
            .replace("w", "v")
            .replace("y", "i")
            .replace("x", "ks")
            // Recognisers often swap voiced and unvoiced pairs ("echo" comes
            // back as "ego"), so treat each pair as one sound.
            .replace("g", "k")
            .replace("d", "t")
            .replace("b", "p")
            .replace("v", "f");
        // A silent-ish h after a consonant (bh, dh, kh, th) rarely survives
        // recognition, and a trailing h never does.
        s = s.replaceAll("([^aeiou])h", "$1").replaceAll("h$", "");
        StringBuilder out = new StringBuilder(s.length());
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (out.length() == 0 || out.charAt(out.length() - 1) != c) out.append(c);
        }
        return out.toString();
    }

    static int editDistance(String a, String b) {
        int[] prev = new int[b.length() + 1];
        int[] cur = new int[b.length() + 1];
        for (int j = 0; j <= b.length(); j++) prev[j] = j;
        for (int i = 1; i <= a.length(); i++) {
            cur[0] = i;
            for (int j = 1; j <= b.length(); j++) {
                int cost = a.charAt(i - 1) == b.charAt(j - 1) ? 0 : 1;
                cur[j] = Math.min(Math.min(cur[j - 1] + 1, prev[j] + 1), prev[j - 1] + cost);
            }
            int[] t = prev;
            prev = cur;
            cur = t;
        }
        return prev[b.length()];
    }
}
