import { describe, it, expect } from "vitest";

process.env.DATABASE_URL ??= "postgresql://unit:test@localhost:5432/none";
process.env.JWT_SECRET ??= "unit-test-jwt-secret-not-real-0123456789";
const { cleanSearchQuery, detectedLanguage, isAffirmative, isNegative, languageTurn, looksLikeEnglish, searchQueryMessages, LANGUAGE_TEXT } = await import("./language.js");
const { buildSystemPrompt } = await import("./agentLoop.js");
const { parseLanguages } = await import("../lib/intakeAutoBuild.js");

describe("multilingual agents", () => {
  it("every agent is told to follow the customer's language, including Zimbabwe's", () => {
    const prompt = buildSystemPrompt("You are Ava for Sunrise Dental.", [], []);
    expect(prompt).toContain(LANGUAGE_TEXT);
    for (const lang of ["Shona", "Ndebele", "Tonga", "Kalanga", "Nambya", "Venda", "Shangani", "Chewa", "Sotho", "Tswana", "Xhosa", "Ndau", "Chibarwe"]) {
      expect(LANGUAGE_TEXT).toContain(lang);
    }
    expect(LANGUAGE_TEXT).toMatch(/switch the moment they switch/);
    expect(LANGUAGE_TEXT).toMatch(/Keep prices, currencies, numbers/);
    // The business's own language rules still win.
    expect(LANGUAGE_TEXT).toMatch(/business's own instructions above say which language/);
  });

  it("only skips the search rewrite for plain English", () => {
    expect(looksLikeEnglish("How much is a check-up?")).toBe(true);
    expect(looksLikeEnglish("What are your opening hours on Saturday")).toBe(true);
    expect(looksLikeEnglish("Ndingawana sei appointment mangwana?")).toBe(false);
    expect(looksLikeEnglish("Imarii?")).toBe(false);
    expect(looksLikeEnglish("Ngicela ukwazi intengo")).toBe(false);
    expect(looksLikeEnglish("Combien coûte une consultation ?")).toBe(false);
    expect(looksLikeEnglish("كم السعر")).toBe(false);
  });

  it("asks for one English query, resolving the conversation", () => {
    const msgs = searchQueryMessages(
      [
        { role: "customer", content: "Do you do braces?" },
        { role: "agent", content: "Yes, we offer braces." },
      ],
      "Imarii?",
    );
    expect(msgs[0]!.content).toMatch(/ONE short English search query/);
    expect(msgs[0]!.content).toMatch(/Kalanga: Dumilani/);
    expect(msgs[0]!.content).toMatch(/only a name, number/);
    expect(msgs[1]!.content).toContain("Customer: Do you do braces?");
    expect(msgs[1]!.content).toContain("Latest customer message:\nImarii?");
    expect(cleanSearchQuery("braces price")).toBe("braces price");
    expect(cleanSearchQuery('"Search query: braces price"')).toBe("braces price");
    expect(cleanSearchQuery("NONE")).toBeNull();
    expect(cleanSearchQuery("LANGUAGE: Shona\nQUERY: braces price")).toBe("braces price");
    expect(cleanSearchQuery("LANGUAGE: Shona\nQUERY: NONE")).toBeNull();
    expect(detectedLanguage("LANGUAGE: Shona mixed with English\nQUERY: braces price")).toBe("Shona mixed with English");
    expect(detectedLanguage("QUERY: braces price")).toBeNull();
    expect(cleanSearchQuery("")).toBeNull();
  });

  it("understands a yes or no in many languages, but only a plain one", () => {
    for (const yes of ["yes", "Yes please", "OK!", "hongu", "Ehe", "Hongu ndatenda", "yebo", "Yebo kulungile", "inde", "ndiyo", "oui", "sim", "👍", "go ahead"]) {
      expect(isAffirmative(yes), yes).toBe(true);
    }
    for (const no of ["no", "No thanks", "kwete", "aiwa", "hatshi", "cha", "ayi", "non", "❌"]) {
      expect(isNegative(no), no).toBe(true);
      expect(isAffirmative(no), no).toBe(false);
    }
    // A change of plan isn't a confirmation — it goes to the model.
    expect(isAffirmative("yes but make it 3pm instead")).toBe(false);
    expect(isAffirmative("hongu asi ndinoda Chipiri")).toBe(false);
    expect(isAffirmative("thanks")).toBe(false);
  });

  it("stays in English by default and offers to switch the moment the customer changes language", () => {
    const plain = languageTurn({ current: null, offered: null, detected: null, message: "Hi, how much is a check-up?" });
    expect(plain).toEqual({ instruction: "", replyLanguage: null, languageOffer: null });

    const offer = languageTurn({ current: null, offered: null, detected: "Shona", message: "Check-up inoita marii?" });
    expect(offer.languageOffer).toBe("Shona");
    expect(offer.replyLanguage).toBeNull();
    expect(offer.instruction).toMatch(/switched from English to Shona/);
    expect(offer.instruction).toMatch(/asking whether they would like to continue the conversation in Shona/);

    // Yes (in any language) switches.
    for (const yes of ["Hongu", "yes please", "ehe"]) {
      const accepted = languageTurn({ current: null, offered: "Shona", detected: "Shona", message: yes });
      expect(accepted).toMatchObject({ replyLanguage: "Shona", languageOffer: null });
    }
    // Simply carrying on in Shona switches too.
    expect(languageTurn({ current: null, offered: "Shona", detected: "Shona", message: "Munovhura here neMugovera?" })).toMatchObject({ replyLanguage: "Shona", languageOffer: null });
    // No keeps English.
    const declined = languageTurn({ current: null, offered: "Shona", detected: "English", message: "No, English is fine" });
    expect(declined).toMatchObject({ replyLanguage: null, languageOffer: null });
    expect(declined.instruction).toMatch(/prefers to stay in English/);

    // Once in Shona, it stays there — and notices a switch back to English.
    expect(languageTurn({ current: "Shona", offered: null, detected: "Shona", message: "Imarii?" })).toMatchObject({ replyLanguage: "Shona", languageOffer: null });
    expect(languageTurn({ current: "Shona", offered: null, detected: "English", message: "How much are braces?" })).toMatchObject({ replyLanguage: "Shona", languageOffer: "English" });
    expect(languageTurn({ current: "Shona", offered: "English", detected: "English", message: "yes" })).toMatchObject({ replyLanguage: null, languageOffer: null });

    // A mix offers the language that isn't the current one, and replies in the mix.
    const mix = languageTurn({ current: null, offered: null, detected: "Shona mixed with English", message: "Ma braces ari how much?" });
    expect(mix.languageOffer).toBe("Shona");
    expect(mix.instruction).toMatch(/same natural mix/);
  });

  it("maps Zimbabwe's languages to their own codes", () => {
    expect(parseLanguages("Shona, Ndebele, Tonga, Kalanga, Nambya, Venda, Shangani, Ndau").codes).toEqual([
      "sn", "nd", "toi", "kck", "nmq", "ve", "ts", "ndc",
    ]);
  });
});
