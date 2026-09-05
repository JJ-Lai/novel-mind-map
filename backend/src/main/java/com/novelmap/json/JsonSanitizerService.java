package com.novelmap.json;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Service;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 防禦性 JSON 解析：過濾 markdown fence 與前後廢話。
 * 對齊開發藍圖 JsonSanitizerService。
 */
@Service
public class JsonSanitizerService {
    private final ObjectMapper objectMapper;

    public JsonSanitizerService(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    public <T> T safeParse(String rawAiResponse, Class<T> type) throws Exception {
        String cleanJson = extractJson(rawAiResponse);
        return objectMapper.readValue(cleanJson, type);
    }

    public String extractJson(String text) {
        String result = text.trim();
        Pattern pattern = Pattern.compile("```(?:json)?\\s*(.*?)\\s*```", Pattern.DOTALL);
        Matcher matcher = pattern.matcher(result);
        if (matcher.find()) {
            result = matcher.group(1);
        }

        int startIndex = result.indexOf("{");
        int endIndex = result.lastIndexOf("}");
        if (startIndex != -1 && endIndex != -1 && startIndex < endIndex) {
            return result.substring(startIndex, endIndex + 1);
        }
        throw new IllegalArgumentException("No valid JSON structure found.");
    }
}
