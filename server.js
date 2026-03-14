const express = require("express")
const axios = require("axios")
const crypto = require("crypto")
const path = require("path")

const app = express()

const PORT = 3000

const partner_id = "2030813"
const partner_key = "shpk7749796d78616e62715758437a626468595a646d6948734a547254537056"
const redirect_url = "https://lotusengv1.onrender.com/callback"

let access_token = ""
let shop_id = ""

app.use(express.static("public"))

function sign(path, timestamp) {
    const base = partner_id + path + timestamp
    return crypto
        .createHmac("sha256", partner_key)
        .update(base)
        .digest("hex")
}

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
        {
            code,
            shop_id,
            partner_id
        }
    )

    access_token = result.data.access_token

    res.redirect("/")

})

app.get("/get_items", async (req, res) => {

    const path = "/api/v2/product/get_item_list"
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
                offset: 0,
                page_size: 10,
                item_status: "NORMAL"
            }
        }
    )

    res.json(result.data)

})

app.listen(PORT, () => {
    console.log("Server running http://localhost:" + PORT)
})