
const crypto = require("crypto")
const config = require("../config")

function sign(path,timestamp,token,shop){

let base = `${config.partner_id}${path}${timestamp}`

if(token){

base += token + shop

}

return crypto
.createHmac("sha256",config.partner_key)
.update(base)
.digest("hex")

}

module.exports = sign
