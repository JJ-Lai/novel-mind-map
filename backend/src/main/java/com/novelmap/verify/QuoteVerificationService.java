package com.novelmap.verify;

import org.springframework.stereotype.Service;

/**
 * Hallucination Checker：引文必須可在原文中找到（忽略空白與引號差異）。
 */
@Service
public class QuoteVerificationService {
    public boolean quoteExistsInText(String quote, String fullText) {
        if (quote == null || quote.isBlank()) return false;
        String q = normalize(quote);
        String t = normalize(fullText);
        return !q.isEmpty() && t.contains(q);
    }

    private String normalize(String s) {
        return s.replaceAll("\\s+", "")
                .replace("「", "")
                .replace("」", "")
                .replace("『", "")
                .replace("』", "")
                .replace("\"", "")
                .replace("'", "");
    }
}
