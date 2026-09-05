package com.novelmap.chunking;

import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 語意邊界文本切片：優先章回、空行、換行、句末，避免腰斬對話引號。
 * 對齊開發藍圖 TextChunkingService。
 */
@Service
public class TextChunkingService {
    private static final int MAX_CHUNK_LENGTH = 3000;
    private static final String[] SPLIT_PATTERNS = {
        "(第[一二三四五六七八九十百千0-9]+[章回節])",
        "\\n\\s*\\n",
        "\\n",
        "([。！？!?][”」』]?[\\s]*)"
    };

    public List<String> splitText(String text) {
        List<String> chunks = new ArrayList<>();
        if (text == null || text.trim().isEmpty()) {
            return chunks;
        }
        processChunk(text.trim(), 0, chunks);
        return chunks;
    }

    private void processChunk(String text, int patternIndex, List<String> result) {
        if (text.length() <= MAX_CHUNK_LENGTH) {
            result.add(text);
            return;
        }
        if (patternIndex >= SPLIT_PATTERNS.length) {
            result.add(text.substring(0, MAX_CHUNK_LENGTH));
            processChunk(text.substring(MAX_CHUNK_LENGTH), patternIndex, result);
            return;
        }

        Pattern pattern = Pattern.compile(SPLIT_PATTERNS[patternIndex]);
        Matcher matcher = pattern.matcher(text);
        int bestCut = -1;
        int searchLimit = Math.min(text.length(), MAX_CHUNK_LENGTH);
        while (matcher.find()) {
            int end = matcher.end();
            if (end > 200 && end <= searchLimit) {
                bestCut = end;
            }
            if (end > searchLimit) {
                break;
            }
        }

        if (bestCut > 0) {
            result.add(text.substring(0, bestCut).trim());
            String rest = text.substring(bestCut).trim();
            if (!rest.isEmpty()) {
                processChunk(rest, patternIndex, result);
            }
        } else {
            processChunk(text, patternIndex + 1, result);
        }
    }
}
