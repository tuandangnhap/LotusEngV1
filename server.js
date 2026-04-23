const express = require("express")
const axios = require("axios")
const ffmpeg = require("fluent-ffmpeg")
ffmpeg.setFfmpegPath("ffmpeg")
const crypto = require("crypto")
const path = require("path")
const multer = require("multer")
const fs = require("fs")

const app = express()
const PORT = 3000
const archiver = require("archiver")

const partner_id = "2030813"
const partner_key = "shpk7749796d78616e62715758437a626468595a646d6948734a547254537056"
const redirect_url = "https://lotusengv1.onrender.com/callback"

const upload = multer({ dest: "uploads/" })

let access_token = ""
let shop_id = ""
let progress = {
    total: 0,
    done: 0
}

app.use(express.static("public"))
app.use(express.json())

/* ================== UTILS ================== */
ffmpeg.getAvailableFormats((err, formats) => {
    if (err) console.log("❌ FFMPEG ERROR:", err)
    else console.log("✅ FFMPEG READY")
})

// sign
function sign(path, timestamp) {
    const base = partner_id + path + timestamp
    return crypto
        .createHmac("sha256", partner_key)
        .update(base)
        .digest("hex")
}

function trimVideo(inputPath, outputPath) {
    return new Promise((resolve, reject) => {
        ffmpeg(inputPath)
            .setStartTime(0)
            .setDuration(55)

            .videoCodec("libx264")
            .audioCodec("aac")

            .outputOptions([
                "-preset ultrafast",
                "-crf 32",
                "-movflags +faststart",
                "-vf scale=720:-2"
            ])

            .on("progress", (p) => {
                console.log(`⏳ Encode: ${p.percent?.toFixed(2)}%`)
            })

            .on("end", () => {
                console.log("✅ Encode done")
                resolve(outputPath)
            })

            .on("error", (err) => {
                console.log("❌ FFMPEG ERROR:", err)
                reject(err)
            })

            .save(outputPath)
    })
}

function getDuration(inputPath) {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(inputPath, (err, metadata) => {
            if (err) return reject(err)
            resolve(metadata.format.duration)
        })
    })
}

// chunk array
function chunkArray(arr, size) {
    const result = []
    for (let i = 0; i < arr.length; i += size) {
        result.push(arr.slice(i, i + size))
    }
    return result
}

// delay
function sleep(ms) {
    return new Promise(r => setTimeout(r, ms))
}

// retry
async function retry(fn, times = 3) {
    for (let i = 0; i < times; i++) {
        try {
            return await fn()
        } catch (e) {
            if (i === times - 1) throw e
            await sleep(500)
        }
    }
}

// concurrency limit
async function runWithLimit(tasks, limit = 3) {
    let index = 0
    const results = []

    async function worker() {
        while (index < tasks.length) {
            const i = index++
            results[i] = await tasks[i]()
        }
    }

    const workers = []
    for (let i = 0; i < limit; i++) {
        workers.push(worker())
    }

    await Promise.all(workers)
    return results
}

/* ================== AUTH ================== */

app.get("/connect", (req, res) => {
    const path = "/api/v2/shop/auth_partner"
    const timestamp = Math.floor(Date.now() / 1000)
    const signature = sign(path, timestamp)

    const url = `https://partner.shopeemobile.com${path}?partner_id=${partner_id}&timestamp=${timestamp}&sign=${signature}&redirect=${redirect_url}`

    res.redirect(url)
})

app.get("/callback", async (req, res) => {
    const code = req.query.code
    shop_id = req.query.shop_id

    const path = "/api/v2/auth/token/get"
    const timestamp = Math.floor(Date.now() / 1000)

    const base = partner_id + path + timestamp
    const signature = crypto
        .createHmac("sha256", partner_key)
        .update(base)
        .digest("hex")

    const result = await axios.post(
        `https://partner.shopeemobile.com${path}?partner_id=${partner_id}&timestamp=${timestamp}&sign=${signature}`,
        { code, shop_id, partner_id }
    )

    access_token = result.data.access_token

    res.redirect("/")
})

app.get("/download_media", async (req, res) => {
    try {

        if (!fs.existsSync("cache.json")) {
            return res.json({ error: "No data" })
        }

        const cache = JSON.parse(fs.readFileSync("cache.json"))
        const items = Object.values(cache)

        req.setTimeout(0)
        res.setTimeout(0)

        res.setHeader("Content-Type", "application/zip")
        res.setHeader("Content-Disposition", "attachment; filename=media.zip")
        res.setHeader("Connection", "keep-alive")
        res.setHeader("Transfer-Encoding", "chunked")
        res.setHeader("X-Accel-Buffering", "no")

        const archive = archiver("zip", {
            zlib: { level: 1 }
        })

        archive.pipe(res)

        archive.on("error", err => {
            console.log("ZIP ERROR:", err)
        })

        // ====== BUILD TASK LIST ======
        const tasks = []

        items.forEach(item => {

            const folder = item.item_name.replace(/[\\/:*?"<>|]/g, "_")

            // ===== NOTE FILES =====
            tasks.push({
                type: "text",
                data: String(item.item_id),
                name: `${folder}/note_id.txt`
            })

            tasks.push({
                type: "text",
                data: String(item.original_price || 0),
                name: `${folder}/note_price.txt`
            })

            tasks.push({
                type: "text",
                data: item.item_name,
                name: `${folder}/note_name.txt`
            })

            tasks.push({
                type: "text",
                data: item.description || "",
                name: `${folder}/note_description.txt`
            })
            // ===== DIMENSION =====
            tasks.push({
                type: "text",
                data: `Length: ${item.dimension?.length || ""}
                Width: ${item.dimension?.width || ""}
                Height: ${item.dimension?.height || ""}
                Weight: ${item.weight || ""}`,
                name: `${folder}/note_dimension.txt`
            })

            // ===== IMAGES =====
            item.images.forEach((url, i) => {
                tasks.push({
                    type: "file",
                    url,
                    name: `${folder}/image_${i + 1}.jpg`
                })
            })

            // ===== VIDEO =====
            if (item.video_url) {
                tasks.push({
                    type: "file",
                    url: item.video_url,
                    name: `${folder}/video.mp4`
                })
            }
        })

        // ====== PROGRESS ======
        progress.total = tasks.length
        progress.done = 0

        console.log("TOTAL FILES:", tasks.length)

        // ====== DOWNLOAD FUNCTION ======

        // ====== CONCURRENCY LIMIT ======
        async function runParallel(tasks, limit = 5) {
            let index = 0
            async function worker() {
                while (index < tasks.length) {
                    const i = index++
                    const task = tasks[i]

                    try {
                        if (task.type === "text") {
                            archive.append(task.data, { name: task.name })
                            progress.done++
                        } else {
                            const response = await axios({
                                url: task.url,
                                method: "GET",
                                responseType: "arraybuffer",
                                timeout: 0
                            })

                            if (response.data && response.data.byteLength > 0) {
                                archive.append(response.data, { name: task.name })
                            } else {
                                console.log("EMPTY:", task.url)
                            }
                            progress.done++
                        }

                    } catch (e) {
                        console.log("FAIL:", task.url || task.name)
                        progress.done++
                    }
                }
            }

            const workers = []
            for (let i = 0; i < limit; i++) {
                workers.push(worker())
            }

            await Promise.all(workers)
        }

        // ⚡ chạy song song
        await runParallel(tasks, 2)

        // 👇 đợi stream flush hết
        await new Promise(r => setTimeout(r, 500))

        await archive.finalize()

        archive.on("end", () => {
            console.log("ZIP STREAM END")
        })
        archive.on("finish", () => {
            console.log("ZIP DONE")
        })

    } catch (e) {
        console.log("ERROR:", e.message)
        res.end()
    }
})

// app.get("/total_parts", (req, res) => {
//
//     const cache = JSON.parse(fs.readFileSync("cache.json"))
//     const items = Object.values(cache)
//
//     const tasks = []
//
//     items.forEach(item => {
//
//         item.images.forEach(url => tasks.push(url))
//         if (item.video_url) tasks.push(item.video_url)
//
//     })
//
//     const size = 100  // mỗi part ~200 file
//     const total = Math.ceil(tasks.length / size)
//
//     res.json({ total })
// })
app.get("/total_parts", (req, res) => {
    const cache = JSON.parse(fs.readFileSync("cache.json"))
    const items = Object.values(cache)

    const size = 10 // 10 item / part
    const total = Math.ceil(items.length / size)

    res.json({ total })
})

app.get("/download_media_part", async (req, res) => {

    try {

        const part = parseInt(req.query.part) || 0
        const size = 10

        const cache = JSON.parse(fs.readFileSync("cache.json"))
        const items = Object.values(cache)

        const tasks = []

        items.forEach(item => {

            const folder = item.item_name.replace(/[\\/:*?"<>|]/g, "_")

            item.images.forEach((url, i) => {
                tasks.push({
                    url,
                    name: `${folder}/image_${i + 1}.jpg`
                })
            })

            if (item.video_url) {
                tasks.push({
                    url: item.video_url,
                    name: `${folder}/video.mp4`
                })
            }
        })

        const start = part * size
        const end = start + size
        const currentItems = items.slice(start, end)

        if (currentItems.length === 0) {
            return res.json({ done: true })
        }

        res.setHeader("Content-Type", "application/zip")
        res.setHeader("Content-Disposition", `attachment; filename=media_part_${part}.zip`)
        res.setHeader("Connection", "keep-alive")
        res.setHeader("Transfer-Encoding", "chunked")

        const archive = archiver("zip", { zlib: { level: 1 } })
        // req.on("close", () => {
        //     console.log("CLIENT CLOSED")
        //     archive.destroy()
        // })
        archive.pipe(res)

        for (const item of currentItems) {

            const folder = item.item_name.replace(/[\\/:*?"<>|]/g, "_")

            // ===== NOTE =====
            archive.append(String(item.item_id), { name: `${folder}/note_id.txt` })
            archive.append(item.item_name, { name: `${folder}/note_name.txt` })
            archive.append(item.description || "", { name: `${folder}/note_description.txt` })
            archive.append(
                `Length: ${item.dimension?.length || ""}
                        Width: ${item.dimension?.width || ""}
                        Height: ${item.dimension?.height || ""}
                        Weight: ${item.weight || ""}`,
                { name: `${folder}/note_dimension.txt` }
            )
            archive.append(String(item.original_price || 0), {
                name: `${folder}/note_price.txt`
            })

            // ===== IMAGE =====
            for (let i = 0; i < item.images.length; i++) {
                try {
                    const response = await axios({
                        url: item.images[i],
                        method: "GET",
                        responseType: "arraybuffer",
                        timeout: 0
                    })



                    if (response.data) {
                        archive.append(response.data, {
                            name: `${folder}/image_${i + 1}.jpg`
                        })
                    }

                } catch (e) {
                    console.log("FAIL IMAGE:", item.images[i])
                }
            }

            // ===== VIDEO =====
            if (item.video_url) {
                try {
                    const response = await axios({
                        url: item.video_url,
                        method: "GET",
                        responseType: "arraybuffer",
                        timeout: 0
                    })

                    if (response.data) {
                        archive.append(response.data, {
                            name: `${folder}/video.mp4`
                        })
                    }

                } catch (e) {
                    console.log("FAIL VIDEO:", item.video_url)
                }
            }
        }

        console.log("FINALIZING ZIP...")

        await new Promise((resolve, reject) => {
            archive.on("end", resolve)
            archive.on("error", reject)
            archive.finalize()
        })
        console.log("ZIP DONE")
        archive.on("finish", () => {
            console.log("ZIP DONE")
        })
    } catch (e) {
        console.log(e)
        res.end()
    }
})

app.get("/progress", (req, res) => {

    res.setHeader("Content-Type", "text/event-stream")
    res.setHeader("Cache-Control", "no-cache")
    res.setHeader("Connection", "keep-alive")

    const interval = setInterval(() => {

        const percent = progress.total === 0
            ? 0
            : Math.floor((progress.done / progress.total) * 100)

        res.write(`data: ${percent}\n\n`)

        if (percent >= 100) {
            clearInterval(interval)
            res.end()
        }

    }, 500)
})

/* ================== GET ITEM LIST ================== */

app.get("/get_items", async (req, res) => {
    const path = "/api/v2/product/get_item_list"

    let offset = 0
    const page_size = 100
    let item_ids = []

    while (true) {
        const timestamp = Math.floor(Date.now() / 1000)

        const base = partner_id + path + timestamp + access_token + shop_id

        const signature = crypto
            .createHmac("sha256", partner_key)
            .update(base)
            .digest("hex")

        const result = await axios.get(
            `https://partner.shopeemobile.com${path}`,
            {
                params: {
                    partner_id,
                    shop_id,
                    access_token,
                    timestamp,
                    sign: signature,
                    offset,
                    page_size,
                    item_status: "NORMAL"
                }
            }
        )

        const data = result.data.response

        data.item.forEach(i => item_ids.push(String(i.item_id)))

        if (!data.has_next_page) break
        offset = data.next_offset
    }
    // ===== REMOVE DUPLICATE =====
    item_ids = [...new Set(item_ids)]

    console.log("Total after unique:", item_ids.length)

    res.json(item_ids)
})

/* ================== GET ITEM BASE OPTIMIZED ================== */

app.post("/get_item_base", upload.single("file"), async (req, res) => {
    try {
        const raw = fs.readFileSync(req.file.path)
        const item_ids = JSON.parse(raw)

        const path = "/api/v2/product/get_item_base_info"

        // ===== CACHE =====
        let cache = {}
        if (fs.existsSync("cache.json")) {
            cache = JSON.parse(fs.readFileSync("cache.json"))
        }

        const missing_ids = item_ids.filter(id => !cache[id])

        console.log("Total:", item_ids.length)
        console.log("Cached:", item_ids.length - missing_ids.length)
        console.log("Need fetch:", missing_ids.length)

        // ===== CHUNK =====
        const chunks = chunkArray(missing_ids, 50)

        let count = 0

        const extraPath = "/api/v2/product/get_item_extra_info"

        const tasks = chunks.map(chunk => async () => {
            await sleep(200)

            return retry(async () => {

                const timestamp = Math.floor(Date.now() / 1000)

                const base = partner_id + path + timestamp + access_token + shop_id
                const sign = crypto.createHmac("sha256", partner_key).update(base).digest("hex")

                // ===== BASE INFO =====
                const result = await axios.get(
                    `https://partner.shopeemobile.com${path}`,
                    {
                        params: {
                            partner_id,
                            shop_id,
                            access_token,
                            timestamp,
                            sign,
                            item_id_list: chunk.join(","),
                            response_optional_fields: "description,description_info,weight,dimension,price_info"
                        }
                    }
                )

                // ===== EXTRA INFO (description) =====
                const timestamp2 = Math.floor(Date.now() / 1000)

                const base2 = partner_id + extraPath + timestamp2 + access_token + shop_id
                const sign2 = crypto.createHmac("sha256", partner_key).update(base2).digest("hex")

                const extra = await axios.get(
                    `https://partner.shopeemobile.com${extraPath}`,
                    {
                        params: {
                            partner_id,
                            shop_id,
                            access_token,
                            timestamp: timestamp2,
                            sign: sign2,
                            item_id_list: chunk.join(",")
                        }
                    }
                )

                const items = result.data?.response?.item_list || []
                const extraItems = extra.data?.response?.item_list || []
                const fetched_ids = items.map(i => String(i.item_id))

                const missing = chunk.filter(id => !fetched_ids.includes(id))

                if (missing.length) {
                    console.log("❌ Missing item:", missing)
                }

                const extraMap = {}
                extraItems.forEach(i => {
                    extraMap[i.item_id] = i.description_info?.extended_description?.field_list?.map(f => f.text || "").join("\n") || ""
                })

                items.forEach(item => {
                    const desc =
                        item.description_info?.extended_description?.field_list
                            ?.map(f => f.text || "")
                            .join("\n")
                        || item.description   // 👈 fallback cực quan trọng
                        || ""
                    cache[item.item_id] = {
                        item_id: item.item_id,
                        item_name: item.item_name,
                        description: desc,
                        dimension: {
                            length: item.dimension?.package_length || "",
                            width: item.dimension?.package_width || "",
                            height: item.dimension?.package_height || ""
                        },
                        weight: item.weight || "",
                        images: item.image?.image_url_list || [],
                        video_url: item.video_info?.[0]?.video_url || "",
                        original_price: item.price_info?.[0]?.original_price || 0
                    }
                })

                count += chunk.length
                console.log(`Progress: ${count}/${missing_ids.length}`)
            })
        })

        // ===== RUN WITH LIMIT =====
        await runWithLimit(tasks, 3)

        // ===== SAVE CACHE =====
        fs.writeFileSync("cache.json", JSON.stringify(cache, null, 2))

        // ===== FINAL RESULT =====
        const result_items = item_ids.map(id => cache[id]).filter(Boolean)

        res.json(result_items)

    } catch (e) {
        res.json({ error: e.message })
    }
})

const FormData = require("form-data")

app.post("/upload_image", upload.single("image"), async (req, res) => {
    try {

        if (!req.file) {
            return res.json({ success: false, error: "No file uploaded" })
        }

        const pathApi = "/api/v2/media_space/upload_image"
        const timestamp = Math.floor(Date.now() / 1000)

        const base = partner_id + pathApi + timestamp + access_token + shop_id
        const signature = crypto
            .createHmac("sha256", partner_key)
            .update(base)
            .digest("hex")

        // 👇 tạo form data
        const form = new FormData()
        form.append("image", fs.createReadStream(req.file.path))

        const result = await axios.post(
            `https://partner.shopeemobile.com${pathApi}?partner_id=${partner_id}&timestamp=${timestamp}&access_token=${access_token}&shop_id=${shop_id}&sign=${signature}`,
            form,
            {
                headers: form.getHeaders(),
                maxContentLength: Infinity,
                maxBodyLength: Infinity
            }
        )

        // 🔥 LẤY URL ĐÚNG CHỖ
        const imageList = result.data?.response?.image_info?.image_url_list || []

        const vnImage = imageList.find(i => i.image_url_region === "VN")

        const finalUrl = vnImage
            ? vnImage.image_url
            : imageList[0]?.image_url || ""

        // ❌ xóa file temp
        fs.unlinkSync(req.file.path)

        res.json({
            success: true,
            url: finalUrl,
            raw: result.data // debug nếu cần
        })

    } catch (e) {
        console.log("UPLOAD ERROR:", e.response?.data || e.message)

        res.json({
            success: false,
            error: e.response?.data || e.message
        })
    }
})

app.post("/update_items_image", async (req, res) => {
    try {

        const { item_ids, image_url } = req.body

        if (!item_ids || !image_url) {
            return res.json({ error: "Missing params" })
        }

        const updatePath = "/api/v2/product/update_item"

        let success = 0
        let fail = 0

        const tasks = item_ids.map(item_id => async () => {

            try {

                const timestamp = Math.floor(Date.now() / 1000)

                const base = partner_id + updatePath + timestamp + access_token + shop_id
                const sign = crypto
                    .createHmac("sha256", partner_key)
                    .update(base)
                    .digest("hex")

                await axios.post(
                    `https://partner.shopeemobile.com${updatePath}?partner_id=${partner_id}&timestamp=${timestamp}&access_token=${access_token}&shop_id=${shop_id}&sign=${sign}`,
                    {
                        item_id: Number(item_id),
                        image: {
                            image_url_list: [image_url]
                        },
                        video_info: [] // 🔥 xóa video
                    }
                )

                success++
                console.log("✅", item_id)

            } catch (e) {
                fail++
                console.log("❌", item_id, e.response?.data || e.message)
            }

        })

        // chạy song song (3 luồng)
        await runWithLimit(tasks, 3)

        res.json({
            success,
            fail,
            total: item_ids.length
        })

    } catch (e) {
        res.json({ error: e.message })
    }
})

app.get("/download_json", (req, res) => {
    try {
        if (!fs.existsSync("cache.json")) {
            return res.json({ error: "No data" })
        }

        const filePath = path.join(__dirname, "cache.json")

        res.setHeader("Content-Type", "application/json")
        res.setHeader("Content-Disposition", "attachment; filename=items.json")

        const stream = fs.createReadStream(filePath)
        stream.pipe(res)

    } catch (e) {
        res.json({ error: e.message })
    }
})
/* ================== START ================== */
app.post("/update_item_media", async (req, res) => {
    try {

        const items = req.body
        const results = []

        for (const key of Object.keys(items)) {

            const item = items[key]

            try {

                console.log("🚀 Processing:", item.item_id)

                if (!item.video_url) {
                    console.log("⚠️ No video, skip")
                    continue
                }

                // =========================
                // 1. DOWNLOAD
                // =========================
                const tempInput = `/tmp/input_${item.item_id}.mp4`
                const tempOutput = `/tmp/output_${item.item_id}.mp4`

// download về file
                const response = await axios({
                    url: item.video_url,
                    method: "GET",
                    responseType: "stream",
                    timeout: 120000
                })

                await new Promise((resolve, reject) => {
                    const writer = fs.createWriteStream(tempInput)
                    response.data.pipe(writer)
                    writer.on("finish", resolve)
                    writer.on("error", reject)
                })

                let finalPath = tempInput

// =========================
// CHECK FILE SIZE (quick rule)
// =========================
                const stat = fs.statSync(tempInput)
                console.log("📦 File size:", stat.size)

// 👉 nếu >60s thường size > ~10MB → cắt luôn cho chắc
                const duration = await getDuration(tempInput)
                console.log("⏱ Duration:", duration)

                if (duration > 58) {
                    console.log("✂️ Trim to 55s...")
                    await trimVideo(tempInput, tempOutput)
                    finalPath = tempOutput
                }

// đọc lại buffer
                const videoBuffer = fs.readFileSync(finalPath)

                if (!videoBuffer || videoBuffer.length < 10000) {
                    throw new Error("Invalid video")
                }

                const md5 = crypto
                    .createHash("md5")
                    .update(videoBuffer)
                    .digest("hex")

                console.log("📦 Size:", videoBuffer.length)
                console.log("🔑 MD5:", md5)

                // =========================
                // 2. INIT
                // =========================
                // =========================
// 2. INIT (FIX CHUẨN)
// =========================
                const initPath = "/api/v2/media_space/init_video_upload"
                const ts1 = Math.floor(Date.now() / 1000)

                const sign1 = crypto
                    .createHmac("sha256", partner_key)
                    .update(partner_id + initPath + ts1 + access_token + shop_id)
                    .digest("hex")

                const initUrl = `https://partner.shopeemobile.com${initPath}`

                const params = {
                    partner_id,
                    timestamp: ts1,
                    access_token,
                    shop_id,
                    sign: sign1
                }

                const body = {
                    file_size: videoBuffer.length,
                    file_md5: md5
                }

// 🔥 LOG FULL REQUEST
                console.log("🟡 INIT REQUEST:")
                console.log(JSON.stringify({ url: initUrl, params, body }, null, 2))

                const initRes = await axios.post(initUrl, body, { params })

// 🔥 LOG FULL RESPONSE
                console.log("🟢 INIT RESPONSE:")
                console.log(JSON.stringify(initRes.data, null, 2))

                if (!initRes.data || initRes.data.error) {
                    throw new Error("INIT API ERROR: " + JSON.stringify(initRes.data))
                }

                const video_upload_id = initRes.data?.response?.video_upload_id

                if (!video_upload_id) {
                    console.log("🚨 MISSING video_upload_id !!!")

                    fs.writeFileSync(
                        `error_missing_upload_id_${Date.now()}.json`,
                        JSON.stringify({
                            request: { url: initUrl, params, body },
                            response: initRes.data
                        }, null, 2)
                    )

                    throw new Error("Missing video_upload_id")
                }

                console.log("✅ video_upload_id:", video_upload_id)

                // =========================
                // 3. UPLOAD CHUNK
                // =========================
                const uploadPath = "/api/v2/media_space/upload_video_part"
                const CHUNK_SIZE = 4 * 1024 * 1024
                let part_seq = 0

                for (let start = 0; start < videoBuffer.length; start += CHUNK_SIZE) {

                    const end = Math.min(start + CHUNK_SIZE, videoBuffer.length)
                    const chunk = videoBuffer.slice(start, end)

                    const chunk_md5 = crypto
                        .createHash("md5")
                        .update(chunk)
                        .digest("hex")

                    const ts2 = Math.floor(Date.now() / 1000)

                    const sign2 = crypto
                        .createHmac("sha256", partner_key)
                        .update(partner_id + uploadPath + ts2 + access_token + shop_id)
                        .digest("hex")

                    const form = new FormData()
                    form.append("video_upload_id", video_upload_id)
                    form.append("part_seq", part_seq)
                    form.append("content_md5", chunk_md5)
                    form.append("part_content", chunk, {
                        filename: `part_${part_seq}.mp4`,
                        contentType: "video/mp4"
                    })

                    const uploadRes = await axios.post(
                        `https://partner.shopeemobile.com${uploadPath}`,
                        form,
                        {
                            params: { partner_id, timestamp: ts2, access_token, shop_id, sign: sign2 },
                            headers: form.getHeaders(),
                            maxContentLength: Infinity,
                            maxBodyLength: Infinity
                        }
                    )

                    console.log(`⬆️ part ${part_seq}`, uploadRes.data)

                    if (uploadRes.data.error) {
                        throw new Error(uploadRes.data.message)
                    }

                    part_seq++
                }

                // =========================
                // 4. COMPLETE (FIX QUAN TRỌNG)
                // =========================
                const completePath = "/api/v2/media_space/complete_video_upload"
                const ts3 = Math.floor(Date.now() / 1000)

                const sign3 = crypto
                    .createHmac("sha256", partner_key)
                    .update(partner_id + completePath + ts3 + access_token + shop_id)
                    .digest("hex")

                const part_seq_list = Array.from({ length: part_seq }, (_, i) => i)

                await axios.post(
                    `https://partner.shopeemobile.com${completePath}`,
                    {
                        video_upload_id,
                        part_seq_list,
                        report_data: {
                            upload_cost: videoBuffer.length
                        }
                    },
                    {
                        params: { partner_id, timestamp: ts3, access_token, shop_id, sign: sign3 }
                    }
                )

                console.log("📦 Complete done")

                // =========================
// 5. WAIT RESULT
// =========================
                // =========================
// 5. WAIT VIDEO READY THẬT
// =========================
                let videoReady = false
                let videoUrls = []

                for (let i = 0; i < 60; i++) {

                    await sleep(2000)

                    const ts = Math.floor(Date.now() / 1000)

                    const path = "/api/v2/media_space/get_video_upload_result"

                    const sign = crypto
                        .createHmac("sha256", partner_key)
                        .update(partner_id + path + ts + access_token + shop_id)
                        .digest("hex")

                    const resultRes = await axios.get(
                        `https://partner.shopeemobile.com${path}`,
                        {
                            params: {
                                partner_id,
                                timestamp: ts,
                                access_token,
                                shop_id,
                                video_upload_id,
                                sign
                            }
                        }
                    )

                    const status = resultRes.data?.response?.status
                    const urls = resultRes.data?.response?.video_url_list || []

                    console.log(`🎬 Status [${i}]:`, status)
                    console.log(`🔗 URL [${i}]:`, urls)

                    if (status === "FAILED") {
                        throw new Error("Video FAILED")
                    }
                    if (status === "SUCCEEDED") {
                        console.log("🎯 VIDEO READY (HAS URL)")
                        videoReady = true
                        videoUrls = urls
                        break
                    }
                }

                if (!videoReady) {
                    console.log("❌ FINAL URL:", videoUrls)
                    throw new Error("Video not usable yet (no URL)")
                }

                // =========================
                // =========================
                // WAIT CDN DONE
                // =========================
                let finalUrls = finalUrls || []
                if (!videoReady) {
                    throw new Error("Video not usable yet")
                }

// 👉 chờ thêm cho chắc
                await sleep(20000)

                const updatePath = "/api/v2/product/update_item"

// =========================
// UPDATE FUNCTION (LOG CHUẨN)
// =========================
                async function updateVideo() {

                    const tsUpdate = Math.floor(Date.now() / 1000)

                    const signUpdate = crypto
                        .createHmac("sha256", partner_key)
                        .update(partner_id + updatePath + tsUpdate + access_token + shop_id)
                        .digest("hex")

                    const url = `https://partner.shopeemobile.com${updatePath}`

                    const params = {
                        partner_id,
                        timestamp: tsUpdate,
                        access_token,
                        shop_id,
                        sign: signUpdate
                    }

                    const body = {
                        item_id: item.item_id,
                        video_info: [
                            {
                                video_upload_id: video_upload_id
                            }
                        ]
                    }

                    // 🔥 LOG REQUEST
                    console.log("========== 🟡 UPDATE_ITEM REQUEST ==========")
                    console.log("Time:", new Date().toISOString())
                    console.log("URL:", url)
                    console.log("Params:", JSON.stringify(params, null, 2))
                    console.log("Body:", JSON.stringify(body, null, 2))

                    const res = await axios.post(url, body, { params })

                    // 🔥 LOG RESPONSE
                    console.log("========== 🟢 UPDATE_ITEM RESPONSE ==========")
                    console.log(JSON.stringify(res.data, null, 2))

                    return res.data
                }

// =========================
// CHECK ITEM FUNCTION
// =========================
                async function checkItem() {

                    const path = "/api/v2/product/get_item_base_info"
                    const ts = Math.floor(Date.now() / 1000)

                    const signCheck = crypto
                        .createHmac("sha256", partner_key)
                        .update(partner_id + path + ts + access_token + shop_id)
                        .digest("hex")

                    const url = `https://partner.shopeemobile.com${path}`

                    const params = {
                        partner_id,
                        timestamp: ts,
                        access_token,
                        shop_id,
                        sign: signCheck,
                        item_id_list: item.item_id,
                        response_optional_fields: "video_info"
                    }

                    console.log("========== 🟡 GET_ITEM_BASE REQUEST ==========")
                    console.log("Time:", new Date().toISOString())
                    console.log("URL:", url)
                    console.log("Params:", JSON.stringify(params, null, 2))

                    const res = await axios.get(url, { params })

                    console.log("========== 🟢 GET_ITEM_BASE RESPONSE ==========")
                    console.log(JSON.stringify(res.data, null, 2))

                    return res.data
                }

// =========================
// RUN UPDATE + CHECK
// =========================
                await updateVideo()
                await sleep(5000)
                await updateVideo()

// 👉 verify với Shopee
                await sleep(5000)
                await checkItem()

            } catch (e) {

                console.log("❌ ERROR:", e.response?.data || e.message)

                results.push({
                    item_id: item.item_id,
                    success: false,
                    error: e.response?.data || e.message
                })
            }
        }

        res.json(results)

    } catch (e) {
        res.json({ error: e.message })
    }
})

app.listen(PORT, () => {
    console.log("Server running http://localhost:" + PORT)
})