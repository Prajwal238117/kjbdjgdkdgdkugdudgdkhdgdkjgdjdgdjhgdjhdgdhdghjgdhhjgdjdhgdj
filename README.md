# WhatsApp Payment Bot

A Node.js bot that monitors Firebase Firestore for new payments and automatically sends WhatsApp notifications with payment details.

## Features

- 🔥 **Firebase Integration**: Monitors Firestore `payments` collection
- 📱 **WhatsApp Notifications**: Sends payment alerts to WhatsApp groups
- 💳 **Payment Management**: Approve/reject payments via WhatsApp commands
- 🤖 **Command System**: Control bot via WhatsApp messages
- 📊 **Status Reports**: Check payment status and details

## Commands

### Server Control
- `start` - Start the server
- `status` - Check server status
- `help` - Show help message
- `ping` - Test bot responsiveness

### Payment Management
- `status [PAYMENT_ID]` - Check payment status
- `[PAYMENT_ID] + approved` - Approve a payment
- `[PAYMENT_ID] + rejected` - Reject a payment

## Setup

1. Install dependencies: `npm install`
2. Configure environment variables (see `.env.example`)
3. Add Firebase service account key
4. Run: `npm start`

## Environment Variables

- `FIREBASE_PROJECT_ID` - Your Firebase project ID
- `WHATSAPP_PHONE_NUMBER` - WhatsApp group/number ID
- `PAYMENT_MESSAGE_TEMPLATE` - Custom message template

## Deployment

This bot is designed to run on cloud platforms like Railway, Render, or Heroku.