import { querySnowflake } from "@/lib/snowflake"
import { errorResponse, rejectCrossSite } from "@/lib/api-utils"
import { checkUploadFile } from "@/lib/upload-utils"

export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  // Multipart, so no JSON check; the Sec-Fetch-Site check stops another site's form from storing a file.
  const refused = rejectCrossSite(req)
  if (refused) return refused
  try {
    const form = await req.formData().catch(() => null)
    const file = form?.get("file")
    if (!(file instanceof File)) return Response.json({ error: "No file was sent." }, { status: 400 })
    const rejected = checkUploadFile(file.name, file.size)
    if (rejected) return Response.json({ error: rejected.error }, { status: rejected.status })
    const base64 = Buffer.from(await file.arrayBuffer()).toString("base64")
    const rows = await querySnowflake("CALL SNOWFLAKE_EXAMPLE.AGENTIC_PARSE_DEMO.UPLOAD_DOCUMENT(?, ?)", {
      binds: [file.name, base64],
    })
    const result = JSON.parse(String(Object.values(rows[0])[0]))
    return Response.json(result, { status: result.ok ? 200 : 422 })
  } catch (e) {
    return errorResponse(e, "Upload failed")
  }
}
