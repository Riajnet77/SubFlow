# SubFlow — Architecture Rules

Leia este documento antes de qualquer mudança no código.
Cada regra aqui existe porque um bug já foi corrigido e não deve voltar.

---

## 1. fontSize — unidade e conversão

**Regra:** `style.fontSize` é sempre em **pixels de tela de preview**.

- No preview (CSS/HTML): renderiza como `fontSize * fontScale` px — já feito pelo `SubtitleBox`
- No canvas de export: converte com `fontSize * (nativeH / dispH)`
- No ASS (server-side): o `PlayResX/PlayResY` do ASS é igual a `browserW/browserH`, então `fontSize` é usado diretamente sem conversão

**Nunca:** usar `fontSize` como pixels absolutos no canvas sem converter. Nunca multiplicar por `/720` ou qualquer altura hardcoded.

---

## 2. preset — não sobrescrever desnecessariamente

**Regra:** só muda `preset` para `"custom"` quando o usuário altera cor, fonte, ou background — **não** quando altera fontSize.

```ts
// CORRETO
const set = (p: Partial<SubStyle>) => onChange({
  ...style, ...p,
  preset: 'fontSize' in p && Object.keys(p).length === 1 ? style.preset : "custom"
});

// ERRADO — perde o preset ao ajustar tamanho
const set = (p: Partial<SubStyle>) => onChange({ ...style, ...p, preset: "custom" });
```

O servidor usa `style.preset` para aplicar efeitos no ASS (shadow, neon, etc). Se chegar `"custom"`, perde os efeitos.

---

## 3. Export — server-side only

**Regra:** o export de vídeo é feito **somente via servidor FFmpeg**. Não reintroduzir export client-side com Canvas + MediaRecorder.

O export client-side foi removido após múltiplas tentativas fracassadas por limitações do browser:
- `captureStream()` é não-confiável em vídeos VFR
- `MediaRecorder` não garante sincronização áudio/vídeo
- `onended` não dispara consistentemente no Chrome com vídeos do Instagram/TikTok

---

## 4. Tradução — formato numerado com Map

**Regra:** a tradução usa o formato `N|||texto` e um `Map<number, string>` para aplicar as traduções. Nunca usar array indexado para mapear traduções.

```ts
// CORRETO — robusto a linhas faltando ou reordenadas
const translationMap = new Map<number, string>();
for (const line of raw.split('\n')) {
  const match = line.match(/^(\d+)\|\|\|(.+)$/);
  if (match) translationMap.set(parseInt(match[1]), match[2].trim());
}
segments = segments.map((s, i) => ({
  ...s,
  text: translationMap.get(i + 1) ?? s.text,
}));

// ERRADO — desalinha se o LLM pular ou juntar linhas
const translated = JSON.parse(raw);
segments = segments.map((s, i) => ({ ...s, text: translated[i] }));
```

Batches de **20 segmentos** no máximo para evitar perda de precisão do LLM.

---

## 5. Áudio — extração sem resampling

**Regra:** ao extrair áudio para o Whisper, **nunca** usar `.audioFrequency()`.

Resampling (ex: 44.1kHz → 16kHz) desloca os PTS dos segmentos e causa drift progressivo entre legenda e fala. Usar `aresample=async=1` para corrigir PTSs irregulares de vídeos VFR sem alterar o sample rate.

```ts
// CORRETO
ffmpeg(inputPath)
  .noVideo()
  .audioCodec('libmp3lame')
  .audioBitrate(128)
  .audioChannels(1)
  .outputOptions(['-af', 'aresample=async=1', '-threads', '1'])

// ERRADO — causa drift progressivo
ffmpeg(inputPath)
  .audioFrequency(16000) // nunca isto
```

---

## 6. Groq import — estático no topo

**Regra:** o import do `groq-sdk` deve ser **estático no topo** do `server.ts`.

```ts
// CORRETO
import Groq from 'groq-sdk';

// ERRADO — quebra o bundle esbuild e derruba a rota silenciosamente
const Groq = (await import('groq-sdk')).default;
```

Import dinâmico dentro de rotas não é incluído corretamente no bundle CJS gerado pelo esbuild, fazendo a rota retornar HTML em vez de JSON.

---

## 7. ffprobe — não usar @ffprobe-installer

**Regra:** não usar o pacote `@ffprobe-installer/ffprobe`. Ele não funciona no Render.

Se precisar de duração do vídeo, usar outra abordagem (ex: ler do Whisper response, ou validar tamanho do arquivo).

---

## 8. Segmentos — máximo 5 segundos

**Regra:** segmentos do Whisper acima de 5 segundos são divididos usando word-level timestamps.

Segmentos longos fazem a legenda ficar na tela tempo demais e parecer desincronizada. O Whisper retorna `timestamp_granularities: ['segment', 'word']` — usar os word timestamps para dividir.

---

## 9. Antes de qualquer mudança

1. Identifique **exatamente** qual linha causa o problema com logs/console antes de mudar código
2. Faça **uma mudança por vez**
3. Teste com: vídeo curto (30s), vídeo longo (5min), vídeo vertical (Instagram), com e sem tradução
4. Se a mudança quebrar qualquer um dos 4 casos, reverta antes de tentar outra abordagem

---

## Stack atual

- **Frontend:** React + TypeScript + Vite
- **Backend:** Express + TypeScript, bundlado com esbuild para CJS
- **Transcrição:** Groq Whisper large-v3
- **Tradução:** Groq llama-3.3-70b-versatile
- **Export vídeo:** FFmpeg com libx264 ultrafast + subtítulos ASS
- **Hospedagem:** Render (build: `vite build && esbuild server.ts --bundle`)
- **Limite:** vídeos até 10 min / 150 MB
