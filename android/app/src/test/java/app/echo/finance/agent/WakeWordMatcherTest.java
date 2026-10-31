package app.echo.finance.agent;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.Arrays;
import java.util.Collections;
import org.junit.Test;

public class WakeWordMatcherTest {

    private static WakeWordMatcher matcher(String name, String... aliases) {
        return new WakeWordMatcher(name, Arrays.asList(aliases));
    }

    @Test
    public void matchesTheNameAnywhereInThePhrase() {
        WakeWordMatcher m = matcher("Nova");
        assertTrue(m.matches("nova"));
        assertTrue(m.matches("hey nova"));
        assertTrue(m.matches("okay nova spent two hundred"));
    }

    @Test
    public void toleratesSmallMishearings() {
        assertTrue(matcher("Nova").matches("hey nora"));
        assertTrue(matcher("Jarvis").matches("jarvi"));
        assertTrue(matcher("Penny").matches("pennie"));
    }

    @Test
    public void joinsNamesSplitIntoSeveralWords() {
        // Out-of-vocabulary names come back as several real words.
        assertTrue(matcher("Kunal").matches("hey ku nal"));
        assertTrue(matcher("Echo Bot").matches("echo bot"));
    }

    @Test
    public void matchesWhatVoskReallyHeard() {
        // Outputs of vosk-model-small-en-in-0.4 for synthesised wake phrases.
        assertTrue(matcher("Echo").matches("ego and fifty for choice"));
        assertTrue(matcher("Nova").matches("nova i spent two hundred on petrol"));
        assertTrue(matcher("Jarvis").matches("jarvis how much did i spend"));
        assertTrue(matcher("Penny").matches("hey penny"));
    }

    @Test
    public void ignoresOrdinarySpeech() {
        WakeWordMatcher m = matcher("Nova");
        assertFalse(m.matches(""));
        assertFalse(m.matches("the"));
        assertFalse(m.matches("i spent two hundred on petrol today"));
        assertFalse(m.matches("hey how are you"));
        assertFalse(matcher("Echo").matches("i bought a cake"));
        assertFalse(matcher("Echo").matches("i went to the market today and bought vegetables"));
        assertFalse(matcher("Nova").matches("how are you doing this evening"));
    }

    @Test
    public void shortNamesNeedAnExactSoundMatch() {
        WakeWordMatcher m = matcher("Max");
        assertTrue(m.matches("hey max"));
        assertFalse(m.matches("hey mat"));
    }

    @Test
    public void usesTaughtAliases() {
        WakeWordMatcher m = matcher("Kunal", "cool nail");
        assertTrue(m.matches("hey cool nail"));
        assertFalse(matcher("Kunal").matches("hey cool nail"));
    }

    @Test
    public void ignoresEmptyNames() {
        assertFalse(new WakeWordMatcher("", Collections.emptyList()).matches("anything"));
    }

    @Test
    public void phoneticKeyFoldsSpellings() {
        assertEquals(WakeWordMatcher.phoneticKey("Philip"), WakeWordMatcher.phoneticKey("filip"));
        assertEquals(WakeWordMatcher.phoneticKey("Jack"), WakeWordMatcher.phoneticKey("jak"));
        assertEquals(WakeWordMatcher.phoneticKey("Kunal"), WakeWordMatcher.phoneticKey("Kunaal"));
    }
}
