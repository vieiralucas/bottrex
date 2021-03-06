#! /usr/bin/env node

const bittrex = require('node.bittrex.api')
const R = require('ramda')

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

      console.log(data.result)
      resolve(data.result.Available)
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

function getOrder(orderId) {
  return new Promise((resolve, reject) => {
    bittrex.sendCustomRequest(`https://bittrex.com/api/v1.1/account/getorder?uuid=${orderId}`, (err, data) => {
        if (err) {
          console.log('failed to get order', orderId)
          reject(err)
          return
        }

        if (!data.success) {
          console.log('failed to get order', orderId, data.message)
          reject(new Error(data.message))
          return
        }

        resolve(data.result)
    }, true)
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

    bittrex.websockets.subscribe([market], (data, client) => {
      if (data.M !== 'updateExchangeState') {
        return
      }

      if (data.A[0].Fills.length <= 0) {
        return
      }

      console.log(`############## ${new Date().toISOString()} ##############`)
      console.log(`Fills: ${data.A[0].Fills.length}`)
      const lastFill = R.pipe(
        R.filter(({Quantity}) => Quantity >= balance),
        R.tap(fills => console.log(`Filtered ${data.A[0].Fills.length - fills.length} because of quantity`)),
        R.sortBy(R.descend(R.prop('TimeStamp'))),
        R.head
      )(data.A[0].Fills)

      if (!lastFill) {
        return
      }
      
      console.log(`Last Fill: type: ${lastFill.OrderType} rate: ${lastFill.Rate} quantity: ${lastFill.Quantity} timestamp: ${lastFill.TimeStamp}`)
      
      const currentPrice = lastFill.Rate
      const rate = currentPrice - distance
      if (currentStopLoss && currentPrice < target) {
        getOrder(currentStopLoss.OrderId)
          .then(order => {
            if (order.Closed) {
              console.log('stop loss filled')
              process.exit(0)
            }
          })
          .catch(() => {
            console.log('failed to get order')
          })
        return
      }

      if (currentPrice > target) {
        if (!currentStopLoss) {
          console.log('place stop loss at', currentPrice - distance)
          placeStopLoss(market, balance, rate, rate)
            .then(stopLoss => {
              currentStopLoss = stopLoss
              console.log(currentStopLoss)
            })
            .catch(err => {
              console.log('couldnt place stop loss')
              console.log(err)
            })
          return
        }
        
        if (currentStopLoss && currentStopLoss.Rate < rate) {
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
          return
        }
      }
    })
  })
  .catch(console.error)
