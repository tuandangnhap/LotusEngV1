const express = require("express")
const http = require("http")
const { Server } = require("socket.io")
const bodyParser = require("body-parser")
const session = require("express-session")

const apiRoutes = require("./routes/api")
const productRoutes = require("./routes/products")
const orderRoutes = require("./routes/orders")

const app = express()
const server = http.createServer(app)
const io = new Server(server)

app.use(bodyParser.json())
app.use(express.urlencoded({ extended: true }))

app.use(session({
    secret: "shopee-secret",
    resave: false,
    saveUninitialized: true
}))

app.use(express.static("public"))

/* ===== LOGIN PAGE ===== */

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

/* ===== LOGIN MIDDLEWARE ===== */

function checkLogin(req, res, next) {

    if (!req.session.user) {
        return res.redirect("/login")
    }

    next()
}

/* ===== PROTECTED ROUTES ===== */

app.use("/api", checkLogin, apiRoutes)
app.use("/products", checkLogin, productRoutes)
app.use("/orders", checkLogin, orderRoutes)

io.on("connection", (socket) => {

    socket.on("cli-command", (cmd) => {

        socket.emit("cli-result", "Executed: " + cmd)

    })

})

/* ===== SHOPEE CALLBACK ===== */

app.get("/callback", (req, res) => {

    const code = req.query.code
    const shop_id = req.query.shop_id

    console.log("Shopee callback:", code, shop_id)

    res.send(`
        <h2>Shop Connected</h2>
        <p>Shop ID: ${shop_id}</p>
        <p>Code: ${code}</p>
    `)

})

server.listen(3000, () => {

    console.log("Shopee Seller Tool running on http://localhost:3000")

})