import express from "express"
import crypto from "crypto"
import axios from "axios"
import fs from "fs"
import config from "../config.js"

const app = express()

app.use(express.static("public"))

app.get("/", (req,res)=>{
    res.sendFile(process.cwd()+"/public/index.html")
})


// CONNECT SHOP
app.get("/connect",(req,res)=>{

    const timestamp = Math.floor(Date.now()/1000)

    const path = "/api/v2/shop/auth_partner"

    const base = `${config.partner_id}${path}${timestamp}`

    const sign = crypto
        .createHmac("sha256",config.partner_key)
        .update(base)
        .digest("hex")

    const url =
        `${config.api_host}${path}`+
        `?partner_id=${config.partner_id}`+
        `&timestamp=${timestamp}`+
        `&sign=${sign}`+
        `&redirect=${config.redirect_url}`

    res.json({url})

})


// CALLBACK
app.get("/callback", async (req,res)=>{

    const {code,shop_id} = req.query

    const timestamp = Math.floor(Date.now()/1000)

    const path = "/api/v2/auth/token/get"

    const base = `${config.partner_id}${path}${timestamp}`

    const sign = crypto
        .createHmac("sha256",config.partner_key)
        .update(base)
        .digest("hex")

    const result = await axios.post(
        `${config.api_host}${path}?partner_id=${config.partner_id}&timestamp=${timestamp}&sign=${sign}`,
        {
            code,
            shop_id,
            partner_id:config.partner_id
        }
    )

    fs.writeFileSync("token.json",JSON.stringify(result.data,null,2))

    res.send("Shop Connected")

})


// GET ITEMS (CLI)
async function getItems(){

    const token = JSON.parse(fs.readFileSync("token.json"))

    const access_token = token.access_token
    const shop_id = token.shop_id

    const timestamp = Math.floor(Date.now()/1000)

    const path="/api/v2/product/get_item_list"

    const base =
        `${config.partner_id}${path}${timestamp}${access_token}${shop_id}`

    const sign = crypto
        .createHmac("sha256",config.partner_key)
        .update(base)
        .digest("hex")

    const url =
        `${config.api_host}${path}`+
        `?partner_id=${config.partner_id}`+
        `&timestamp=${timestamp}`+
        `&access_token=${access_token}`+
        `&shop_id=${shop_id}`+
        `&sign=${sign}`+
        `&offset=0&limit=100`

    const res = await axios.get(url)

    return res.data

}


export default app