const express = require("express")
const axios = require("axios")
const crypto = require("crypto")
const path = require("path")
const multer = require("multer")
const fs = require("fs")

const app = express()
const PORT = 3000

const partner_id = "2030813"
const partner_key = "shpk7749796d78616e62715758437a626468595a646d6948734a547254537056"
const redirect_url = "https://lotusengv1.onrender.com/callback"

const upload = multer({ dest: "uploads/" })

let access_token = ""
let shop_id = ""

app.use(express.static("public"))

/* ================== UTILS ================== */

// sign
function sign(path, timestamp) {
    const base = partner_id + path + timestamp
    return crypto
        .createHmac("sha256", partner_key)
        .update(base)
        .digest("hex")
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

        const tasks = chunks.map(chunk => async () => {
            await sleep(200) // chống rate limit

            return retry(async () => {
                const timestamp = Math.floor(Date.now() / 1000)

                const base = partner_id + path + timestamp + access_token + shop_id

                const sign = crypto
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
                            sign,
                            item_id_list: chunk.join(",")
                        }
                    }
                )

                const items = result.data.response.item_list || []

                items.forEach(item => {
                    cache[item.item_id] = {
                        item_id: item.item_id,
                        item_name: item.item_name,
                        images: item.image?.image_url_list || [],
                        video_url: item.video_info?.[0]?.video_url || ""
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

/* ================== START ================== */

app.listen(PORT, () => {
    console.log("Server running http://localhost:" + PORT)
})