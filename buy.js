#! /usr/bin/env node

const crypto = require('crypto')
const request = require('request-promise')

const apiKey = process.env.BITTREX_API_KEY
const apiSecret = process.env.BITTREX_API_SECRET

function buy(currency, BTCAmount) {
  const options = {
    uri: `https://bittrex.com/api/v1.1/public/getmarketsummary?market=btc-${currency}`,
    json: true, // Automatically parses the JSON string in the response
  }

  return request(options).then(data => {
    let ask = 0
    for (let i in data.result) {
      const aResult = data.result[i]
      const [ref, marketName] = aResult.MarketName.split('-')
      if (
        ref === 'BTC' &&
        marketName.toLowerCase() === currency.toLowerCase()
      ) {
        ask = aResult.Ask
      }
    }

    const maxRate = ask + ask * 0.05 // Buying 5% higher than current price

    let amountToBuy = BTCAmount * (1 / maxRate)
    amountToBuy = amountToBuy - amountToBuy * 0.0025 // Fee

    const nonce = new Date().getTime()
    const url =
      'https://bittrex.com/api/v1.1/market/buylimit?apikey=' +
      apiKey +
      '&market=BTC-' +
      currency +
      '&quantity=' +
      amountToBuy +
      '&rate=' +
      maxRate +
      '&nonce=' +
      nonce

    const sign = crypto
      .createHmac('sha512', apiSecret)
      .update(url)
      .digest('hex')

    return request({
      uri: url,
      json: true,
      headers: {
        apisign: sign,
      },
    })
  })
}

function getBalance() {
  const nonce = new Date().getTime()
  const uri = `https://bittrex.com/api/v1.1/account/getbalance?apikey=${apiKey}&currency=BTC&nonce=${nonce}`
  const sign = crypto
    .createHmac('sha512', apiSecret)
    .update(uri)
    .digest('hex')

  return request({ uri, json: true, headers: { apisign: sign } }).then(data => {
    if (data.success) {
      return data.result.Available
    }

    return Promise.reject(data.message)
  })
}

const currency = process.argv[2]
let amount = Number(process.argv[3])
if (Number.isNaN(amount)) {
  amount = 1
}

getBalance()
  .then(availableBTC => buy(currency, availableBTC * amount))
  .then(console.log)
  .catch(console.log)
