import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const API_KEY = Deno.env.get("ASSEMBLYAI_API_KEY");
  if (!API_KEY) {
    return new Response(JSON.stringify({ error: "ASSEMBLYAI_API_KEY not set" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const { audio } = await req.json();
    if (!audio) {
      return new Response(JSON.stringify({ error: "No audio data" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Decode base64 to binary
    const binaryString = atob(audio);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    // Step 1: Upload audio
    const uploadRes = await fetch("https://api.assemblyai.com/v2/upload", {
      method: "POST",
      headers: { Authorization: API_KEY, "Content-Type": "application/octet-stream" },
      body: bytes,
    });
    if (!uploadRes.ok) {
      return new Response(JSON.stringify({ error: "Upload failed" }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { upload_url } = await uploadRes.json();

    // Step 2: Start transcription
    const transcriptRes = await fetch("https://api.assemblyai.com/v2/transcript", {
      method: "POST",
      headers: { Authorization: API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ audio_url: upload_url, speech_models: ["universal-2"] }),
    });
    if (!transcriptRes.ok) {
      return new Response(JSON.stringify({ error: "Transcription failed" }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { id } = await transcriptRes.json();

    // Step 3: Poll until done (up to 60 seconds)
    let result = null;
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const pollRes = await fetch(`https://api.assemblyai.com/v2/transcript/${id}`, {
        headers: { Authorization: API_KEY },
      });
      const poll = await pollRes.json();
      if (poll.status === "completed") { result = poll; break; }
      if (poll.status === "error") throw new Error(poll.error);
    }

    if (!result) {
      return new Response(JSON.stringify({ error: "Timeout" }), {
        status: 504, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ text: result.text || "" }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("Whisper error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
