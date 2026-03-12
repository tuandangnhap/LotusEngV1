
const axios = require("axios")
const config = require("../config")
const sign = require("./signature")

async function callAPI(path,params={}){

const timestamp = Math.floor(Date.now()/1000)

const signature = sign(path,timestamp,params.access_token,params.shop_id)

const url = config.api_host + path

const res = await axios.get(url,{
params:{
partner_id:config.partner_id,
timestamp:timestamp,
sign:signature,
...params
}
})

return res.data

}

module.exports = callAPI
