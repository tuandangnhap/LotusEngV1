const express = require("express")
const http = require("http")
const { Server } = require("socket.io")
const bodyParser = require("body-parser")
const session = require("express-session")
const axios = require("axios")
const crypto = require("crypto")
const fs = require("fs")

const apiRoutes = require("./routes/api")
const productRoutes = require("./routes/products")
const orderRoutes = require("./routes/orders")

const app = express()
const server = http.createServer(app)
const io = new Server(server)

/* ===================== CONFIG ===================== */

const partner_id = 2030813
const partner_key = "shpk7749796d78616e62715758437a626468595a646d6948734a547254537056"
const redirect_url = "https://lotusengv1.onrender.com/callback"

let access_token = null
let shop_id_global = null

/* ===================== LOAD TOKEN ===================== */

if (fs.existsSync("token.json")) {
    const data = JSON.parse(fs.readFileSync("token.json"))
    access_token = data.access_token
    shop_id_global = data.shop_id
}

/* ===================== MIDDLEWARE ===================== */

app.use(bodyParser.json())
app.use(express.urlencoded({ extended: true }))

app.use(session({
    secret: "shopee-secret",
    resave: false,
    saveUninitialized: true
}))

app.use(express.static("public"))

/* ===================== CONNECT SHOP ===================== */

app.get("/connect", (req, res) => {

    try {

        const timestamp = Math.floor(Date.now() / 1000)
        const path = "/api/v2/shop/auth_partner"

        const base = `${partner_id}${path}${timestamp}`

        const sign = crypto
            .createHmac("sha256", partner_key)
            .update(base)
            .digest("hex")

        const url =
            `https://partner.shopeemobile.com${path}` +
            `?partner_id=${partner_id}` +
            `&timestamp=${timestamp}` +
            `&sign=${sign}` +
            `&redirect=${redirect_url}`

        res.redirect(url)

    } catch (err) {

        console.log("CONNECT ERROR:", err)
        res.status(500).send(err.message)

    }

})

/* ===================== LOGIN PAGE ===================== */

app.get("/login", (req, res) => {
    res.sendFile(__dirname + "/public/login.html")
})

app.post("/login", (req, res) => {

    const { username, password } = req.body

    if (username === "admin" && password === "123456") {
        req.session.user = username
        return res.redirect("/")
    }

    res.send("Sai tài khoản hoặc mật khẩu")
})

app.get("/logout", (req, res) => {
    req.session.destroy()
    res.redirect("/login")
})

/* ===================== LOGIN MIDDLEWARE ===================== */

function checkLogin(req, res, next) {

    if (!req.session.user) {
        return res.redirect("/login")
    }

    next()
}

/* ===================== PROTECTED ROUTES ===================== */

app.use("/api", checkLogin, apiRoutes)
app.use("/products", checkLogin, productRoutes)
app.use("/orders", checkLogin, orderRoutes)

/* ===================== SHOPEE CALLBACK ===================== */

app.get("/callback", async (req, res) => {

    try {

        const code = req.query.code
        const shop_id = parseInt(req.query.shop_id)

        shop_id_global = shop_id

        console.log("Shopee callback received")
        console.log("Shop ID:", shop_id)
        console.log("Code:", code)

        const path = "/api/v2/auth/token/get"
        const timestamp = Math.floor(Date.now() / 1000)

        const base = `${partner_id}${path}${timestamp}`

        const sign = crypto
            .createHmac("sha256", partner_key)
            .update(base)
            .digest("hex")

        const url =
            `https://partner.shopeemobile.com${path}` +
            `?partner_id=${partner_id}` +
            `&timestamp=${timestamp}` +
            `&sign=${sign}`

        const response = await axios.post(url, {
            code: code,
            shop_id: shop_id,
            partner_id: partner_id
        })

        access_token = response.data.access_token

        fs.writeFileSync("token.json", JSON.stringify({
            access_token,
            shop_id
        }, null, 2))

        console.log("Access token saved")

        res.send(`
            <h2>Shop Connected Successfully</h2>
            <p>Shop ID: ${shop_id}</p>
            <p>Token saved</p>
            <a href="/">Go Dashboard</a>
        `)

    } catch (err) {

        console.log("TOKEN ERROR:", err.response?.data || err.message)

        res.send("Token error")

    }

})

/* ===================== GET ITEM LIST ===================== */

async function getItemList() {

    if (!access_token) {
        return { error: "No access token" }
    }

    const path = "/api/v2/product/get_item_list"
    const timestamp = Math.floor(Date.now() / 1000)

    const base =
        `${partner_id}${path}${timestamp}${access_token}${shop_id_global}`

    const sign = crypto
        .createHmac("sha256", partner_key)
        .update(base)
        .digest("hex")

    const url =
        `https://partner.shopeemobile.com${path}` +
        `?partner_id=${partner_id}` +
        `&timestamp=${timestamp}` +
        `&access_token=${access_token}` +
        `&shop_id=${shop_id_global}` +
        `&sign=${sign}` +
        `&offset=0&page_size=20` +
        `&item_status=NORMAL`

    const response = await axios.get(url)

    return response.data
}

/* ===================== SOCKET CLI ===================== */

io.on("connection", (socket) => {

    console.log("CLI Connected")

    socket.on("cli-command", async (cmd) => {

        console.log("CLI:", cmd)

        try {

            if (cmd === "get_item_list") {

                const data = await getItemList()

                socket.emit("cli-result", JSON.stringify(data, null, 2))

            }

            else if (cmd === "token") {

                socket.emit("cli-result", access_token || "No token")

            }

            else {

                socket.emit("cli-result", "Unknown command")

            }

        } catch (err) {

            socket.emit("cli-result", err.message)

        }

    })

})

/* ===================== START SERVER ===================== */

server.listen(3000, () => {

    console.log("")
    console.log("Shopee Seller Tool running")
    console.log("http://localhost:3000")
    console.log("")
    console.log("Connect shop:")
    console.log("http://localhost:3000/connect")
    console.log("")

})