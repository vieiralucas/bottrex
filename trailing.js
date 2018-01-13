#! /usr/bin/env node

const bittrex = require('node.bittrex.api')

const apikey = process.env.BITTREX_API_KEY
const apisecret = process.env.BITTREX_API_SECRET

const currency = process.argv[2]
const target = Number(process.argv[3])
const distance = Number(process.argv[4])

if (process.argv.length < 3) {
  console.log('missing arguments')
  return
}

if (Number.isNaN(target)) {
  console.log('invalid target')
  return
}

if (Number.isNaN(distance) || target - distance < 0) {
  console.log('invalid distance')
  return
}

bittrex.options({
  apikey,
  apisecret,
  verbose: true,
  cleartext: false,
  inverse_callback_arguments: true,
})

function getBalance(currency) {
  return new Promise((resolve, reject) => {
    bittrex.getbalance({ currency }, (err, data) => {
      if (err) {
        reject(err)
        return
      }

      if (!data.success) {
        reject(new Error(data.message))
        return
      }

      resolve(data.result.Balance)
    })
  })
}

function placeStopLoss(market, balance, rate, target) {
  return new Promise((resolve, reject) => {
    bittrex.tradesell(
      {
        MarketName: market,
        OrderType: 'LIMIT',
        Quantity: balance,
        Rate: rate,
        TimeInEffect: 'GOOD_TIL_CANCELLED',
        ConditionType: 'LESS_THAN', // supported options are 'NONE', 'GREATER_THAN', 'LESS_THAN'
        Target: target, // used in conjunction with ConditionType
      },
      (err, data) => {
        if (err) {
          console.log(`Failed to place stop loss for ${market}`)
          reject(err)
          return
        }

        if (!data.success) {
          console.log(`success is false when placing stop loss for ${market}`)
          console.log(data.message)
          reject(new Error(data.message))
          return
        }

        resolve(data.result)
      }
    )
  })
}

function cancelOrder(orderId) {
  return new Promise((resolve, reject) => {
    bittrex.sendCustomRequest(
      `https://bittrex.com/api/v1.1/market/cancel?&uuid=${orderId}`,
      (err, data) => {
        if (err) {
          console.log('failed to cancel order', orderId)
          reject(err)
          return
        }

        if (!data.success) {
          console.log('failed to cancel order', orderId, data.message)
          reject(new Error(data.message))
          return
        }

        resolve(data.result)
      },
      true
    )
  })
}

getBalance(currency)
  .then(balance => {
    const market = `BTC-${currency.toUpperCase()}`
    let currentStopLoss
    let running = false
    const interval = setInterval(() => {
      if (running) {
        console.log('already running')
        return
      }

      running = true
      bittrex.getorderbook({ market, depth: 10, type: 'buy' }, (err, data) => {
        if (err) {
          console.log(`Failed to get orderbook for ${market}`)
          console.log('Error:', err)
          running = false
          return
        }

        if (!data.success) {
          console.log(`Success false to get orderbook for ${market}`)
          console.log('Message: ', data.message)
          running = false
          return
        }

        const buyPrice = data.result[0].Rate
        const rate = buyPrice - distance

        if (buyPrice > target) {
          console.log('place stop loss at', buyPrice - distance)
          if (!currentStopLoss) {
            placeStopLoss(market, balance, rate, rate)
              .then(stopLoss => {
                currentStopLoss = stopLoss
                console.log(currentStopLoss)
              })
              .catch(err => {
                console.log('couldnt place stop loss')
                console.log(err)
              })
              .then(() => {
                running = false
              })
            return
          }

          if (currentStopLoss.Rate < rate) {
            cancelOrder(currentStopLoss.OrderId)
              .then(() => placeStopLoss(market, balance, rate, rate))
              .then(stopLoss => {
                currentStopLoss = stopLoss
                console.log(currentStopLoss)
              })
              .catch(err => {
                console.log('couldnt replace stop loss')
                console.log(err)
              })
              .then(() => {
                running = false
              })
            return
          }

          running = false
          return
        }
        running = false
      })
    }, 1000)
  })
  .catch(console.error)
