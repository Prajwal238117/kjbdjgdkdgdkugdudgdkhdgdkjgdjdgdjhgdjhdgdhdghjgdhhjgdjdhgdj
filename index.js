require('dotenv').config();
const admin = require('firebase-admin');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

// Initialize Firebase Admin SDK
let db;
try {
    let serviceAccount;
    
    // Check if we have the service account as an environment variable (for cloud deployment)
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
        serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
        console.log('✅ Using Firebase service account from environment variable');
    } else {
        // Fallback to file (for local development)
        serviceAccount = require('./firebase-service-account.json');
        console.log('✅ Using Firebase service account from file');
    }
    
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: process.env.FIREBASE_PROJECT_ID || serviceAccount.project_id
    });
    db = admin.firestore();
    console.log('✅ Firebase Admin SDK initialized successfully');
} catch (error) {
    console.error('❌ Error initializing Firebase Admin SDK:', error.message);
    console.log('Please make sure you have:');
    console.log('1. Set FIREBASE_SERVICE_ACCOUNT environment variable (for cloud deployment)');
    console.log('2. OR downloaded your Firebase service account key file');
    console.log('3. Set FIREBASE_PROJECT_ID environment variable');
    process.exit(1);
}

// Initialize WhatsApp client
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu'
        ]
    },
    webVersionCache: {
        type: 'remote',
        remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html',
    }
});

// WhatsApp connection status
let isWhatsAppReady = false;
let isServerRunning = true;
let reconnectAttempts = 0;
const maxReconnectAttempts = 10;
let messageQueue = []; // Queue for messages when WhatsApp is not ready

// WhatsApp event handlers - minimal output
client.on('qr', (qr) => {
    console.log('QR Code generated - scan with WhatsApp');
});

client.on('change_state', (state) => {
    if (state === 'CONFLICT' || state === 'UNPAIRED') {
        console.log('WhatsApp needs authentication');
    }
});

client.on('disconnected', (reason) => {
    console.log('⚠️ WhatsApp client disconnected:', reason);
    isWhatsAppReady = false;
    
    if (reconnectAttempts < maxReconnectAttempts) {
        reconnectAttempts++;
        console.log(`🔄 Attempting to reconnect... (${reconnectAttempts}/${maxReconnectAttempts})`);
        setTimeout(() => {
            client.initialize();
        }, 5000);
    } else {
        console.error('❌ Max reconnection attempts reached. Please restart the application.');
    }
});

client.on('ready', async () => {
    console.log('WhatsApp ready');
    isWhatsAppReady = true;
    reconnectAttempts = 0;
    
    // Process queued messages
    if (messageQueue.length > 0) {
        console.log(`Processing ${messageQueue.length} queued messages`);
        for (const queuedMessage of messageQueue) {
            await sendWhatsAppMessage(queuedMessage);
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        messageQueue = [];
    }
});

client.on('authenticated', () => {
    console.log('WhatsApp authenticated');
});

client.on('auth_failure', (msg) => {
    console.log('Auth failed:', msg);
});

// Listen for messages and handle commands
client.on('message', (message) => {
    if (message.from.includes('@g.us')) {
        console.log(`Group ID: ${message.from}`);
    }
    handleCommand(message);
});

client.on('disconnected', (reason) => {
    console.log('⚠️ WhatsApp client disconnected:', reason);
    isWhatsAppReady = false;
    
    if (reconnectAttempts < maxReconnectAttempts) {
        reconnectAttempts++;
        console.log(`🔄 Attempting to reconnect... (${reconnectAttempts}/${maxReconnectAttempts})`);
        setTimeout(() => {
            client.initialize();
        }, 5000);
    } else {
        console.error('❌ Max reconnection attempts reached. Please restart the application.');
    }
});

// Function to handle WhatsApp commands
async function handleCommand(message) {
    const originalMessage = message.body.trim();
    const messageText = originalMessage.toLowerCase().trim();
    const chatId = message.from;
    
    // Only respond to commands from the configured number/group
    const configuredNumber = process.env.WHATSAPP_PHONE_NUMBER;
    if (!configuredNumber || chatId !== configuredNumber) {
        return;
    }
    
    try {
        // Check for payment status command: "status [PAYMENT_ID]" (case-sensitive)
        const statusMatch = originalMessage.match(/^status\s+([a-zA-Z0-9_-]+)$/i);
        if (statusMatch) {
            const paymentId = statusMatch[1]; // Keep original case
            await handleStatusCheck(paymentId, message);
            return;
        }
        
        // Check for payment approval command: "[PAYMENT_ID] + approved" (case-sensitive)
        const approvalMatch = originalMessage.match(/^([a-zA-Z0-9_-]+)\s*\+\s*approved$/i);
        if (approvalMatch) {
            const paymentId = approvalMatch[1]; // Keep original case
            await handlePaymentApproval(paymentId, message);
            return;
        }
        
        // Check for payment rejection command: "[PAYMENT_ID] + rejected" (case-sensitive)
        const rejectionMatch = originalMessage.match(/^([a-zA-Z0-9_-]+)\s*\+\s*rejected$/i);
        if (rejectionMatch) {
            const paymentId = rejectionMatch[1]; // Keep original case
            await handlePaymentRejection(paymentId, message);
            return;
        }
        
        switch (messageText) {
                
            case 'start':
            case 'start server':
                if (!isServerRunning) {
                    isServerRunning = true;
                    await message.reply('✅ Server started! Monitoring payments...');
                    console.log('✅ Server start command received');
                } else {
                    await message.reply('ℹ️ Server is already running!');
                }
                break;
                
            case 'status':
            case 'server status':
                const status = isServerRunning ? '🟢 Running' : '🔴 Stopped';
                const whatsappStatus = isWhatsAppReady ? '🟢 Connected' : '🔴 Disconnected';
                const queueStatus = messageQueue.length > 0 ? `📝 ${messageQueue.length} queued` : '✅ No queue';
                await message.reply(`📊 Server Status:\n${status}\nWhatsApp: ${whatsappStatus}\nQueue: ${queueStatus}`);
                break;
                
            case 'help':
            case 'commands':
                const helpText = `🤖 Available Commands:

🔧 Server Control:
• start - Start the server  
• status - Check server status
• help - Show this help message
• ping - Test bot responsiveness

💳 Payment Management:
• status [PAYMENT_ID] - Check payment status
• [PAYMENT_ID] + approved - Approve a payment
• [PAYMENT_ID] + rejected - Reject a payment

📋 Examples:
• status 5SQE58Q9SezDZLPjTME1
• 5SQE58Q9SezDZLPjTME1 + approved
• 5SQE58Q9SezDZLPjTME1 + rejected`;
                await message.reply(helpText);
                break;
                
            case 'ping':
                await message.reply('🏓 Pong! Server is alive.');
                break;
                
            default:
                // Don't respond to random messages, only commands
                break;
        }
    } catch (error) {
        console.error('❌ Error handling command:', error.message);
    }
}

// Function to check payment status
async function handleStatusCheck(paymentId, message) {
    try {
        console.log(`🔍 Checking status for payment ID: ${paymentId}`);
        
        const paymentDoc = await db.collection('payments').doc(paymentId).get();
        
        if (!paymentDoc.exists) {
            await message.reply(`❌ Payment ID "${paymentId}" not found in database.`);
            return;
        }
        
        const paymentData = paymentDoc.data();
        const status = paymentData.status || 'pending';
        const needsVerification = paymentData.needsManualVerification || false;
        const reviewedAt = paymentData.reviewedAt ? 
            new Date(paymentData.reviewedAt._seconds * 1000).toLocaleString() : 'Not reviewed';
        
        // Extract variant info - try document level first, then orderItems array
        let variantInfo = 'N/A';
        if (paymentData.variant && paymentData.variant.label) {
            variantInfo = `${paymentData.variant.label} (Rs ${paymentData.variant.price || 'N/A'})`;
        } else if (paymentData.orderItems && paymentData.orderItems[0] && paymentData.orderItems[0].variant) {
            const variant = paymentData.orderItems[0].variant;
            variantInfo = `${variant.label || 'N/A'} (Rs ${variant.price || 'N/A'})`;
        }
            
        const statusMessage = `📊 Payment Status Report

Payment ID: ${paymentId}
Customer: ${paymentData.fullName || paymentData.customerName || 'N/A'}
Amount: ${paymentData.orderTotal || 'N/A'}
Variant: ${variantInfo}
Status: ${status.toUpperCase()}
Needs Verification: ${needsVerification ? 'Yes' : 'No'}
Reviewed At: ${reviewedAt}
Payment Method: ${paymentData.paymentMethod || 'N/A'}

💡 To approve: Send "${paymentId} + approved"`;
        
        await message.reply(statusMessage);
        console.log(`✅ Status check completed for payment: ${paymentId}`);
        
    } catch (error) {
        console.error('❌ Error checking payment status:', error.message);
        await message.reply('❌ Error checking payment status. Please try again.');
    }
}

// Function to handle payment approval
async function handlePaymentApproval(paymentId, message) {
    try {
        console.log(`✅ Processing approval for payment ID: ${paymentId}`);
        
        const paymentRef = db.collection('payments').doc(paymentId);
        const paymentDoc = await paymentRef.get();
        
        if (!paymentDoc.exists) {
            await message.reply(`❌ Payment ID "${paymentId}" not found in database.`);
            return;
        }
        
        const paymentData = paymentDoc.data();
        const currentStatus = paymentData.status || 'pending';
        
        if (currentStatus === 'approved') {
            await message.reply(`ℹ️ Payment "${paymentId}" is already approved.`);
            return;
        }
        
        // Update payment status in database
        await paymentRef.update({
            status: 'approved',
            needsManualVerification: false,
            reviewedAt: new Date(),
            approvedBy: 'WhatsApp Bot',
            approvedAt: new Date()
        });
        
        const approvalMessage = `✅ Payment Approved Successfully!

Payment ID: ${paymentId}
Customer: ${paymentData.fullName || 'N/A'}
Amount: ${paymentData.orderTotal || 'N/A'}
Status: APPROVED ✅
Approved At: ${new Date().toLocaleString()}
Approved By: WhatsApp Bot

The payment has been updated in the database.`;
        
        await message.reply(approvalMessage);
        console.log(`✅ Payment ${paymentId} approved successfully`);
        
    } catch (error) {
        console.error('❌ Error approving payment:', error.message);
        await message.reply('❌ Error approving payment. Please try again.');
    }
}

// Function to handle payment rejection
async function handlePaymentRejection(paymentId, message) {
    try {
        console.log(`❌ Processing rejection for payment ID: ${paymentId}`);
        
        const paymentRef = db.collection('payments').doc(paymentId);
        const paymentDoc = await paymentRef.get();
        
        if (!paymentDoc.exists) {
            await message.reply(`❌ Payment ID "${paymentId}" not found in database.`);
            return;
        }
        
        const paymentData = paymentDoc.data();
        const currentStatus = paymentData.status || 'pending';
        
        if (currentStatus === 'rejected') {
            await message.reply(`ℹ️ Payment "${paymentId}" is already rejected.`);
            return;
        }
        
        // Update payment status in database
        await paymentRef.update({
            status: 'rejected',
            needsManualVerification: false,
            reviewedAt: new Date(),
            rejectedBy: 'WhatsApp Bot',
            rejectedAt: new Date()
        });
        
        const rejectionMessage = `❌ Payment Rejected Successfully!

Payment ID: ${paymentId}
Customer: ${paymentData.fullName || 'N/A'}
Amount: ${paymentData.orderTotal || 'N/A'}
Status: REJECTED ❌
Rejected At: ${new Date().toLocaleString()}
Rejected By: WhatsApp Bot

The payment has been updated in the database.`;
        
        await message.reply(rejectionMessage);
        console.log(`❌ Payment ${paymentId} rejected successfully`);
        
    } catch (error) {
        console.error('❌ Error rejecting payment:', error.message);
        await message.reply('❌ Error rejecting payment. Please try again.');
    }
}

// Function to send WhatsApp message
async function sendWhatsAppMessage(paymentData) {
    if (!isWhatsAppReady) {
        console.log('⚠️ WhatsApp client not ready. Message will be queued.');
        messageQueue.push(paymentData);
        console.log(`📝 Message queued. Queue size: ${messageQueue.length}`);
        return false;
    }

    try {
        const phoneNumber = process.env.WHATSAPP_PHONE_NUMBER;
        if (!phoneNumber) {
            console.error('❌ WhatsApp phone number/group ID not configured in environment variables');
            return false;
        }
        
        console.log(`📤 Sending message to: ${phoneNumber}`);

        // Format the message with payment details
        const message = formatPaymentMessage(paymentData);
        
        // Send the message
        await client.sendMessage(phoneNumber, message);
        console.log('✅ WhatsApp message sent successfully');
        return true;
    } catch (error) {
        console.error('❌ Error sending WhatsApp message:', error.message);
        return false;
    }
}

// Function to format payment message
function formatPaymentMessage(paymentData) {
    
    // Extract variant details - try document level first, then orderItems array
    let variantLabel = 'N/A';
    let variantPrice = 'N/A';
    
    if (paymentData.variant && paymentData.variant.label) {
        // Variant at document level
        variantLabel = paymentData.variant.label;
        variantPrice = paymentData.variant.price || 'N/A';
    } else if (paymentData.orderItems && paymentData.orderItems[0] && paymentData.orderItems[0].variant) {
        // Variant in orderItems array
        variantLabel = paymentData.orderItems[0].variant.label || 'N/A';
        variantPrice = paymentData.orderItems[0].variant.price || 'N/A';
    }
    
    // Extract product details - try multiple possible locations
    const productName = paymentData.productName || 
                       (paymentData.orderItems && paymentData.orderItems[0] && paymentData.orderItems[0].name) ||
                       'N/A';
    
    // Extract price - try multiple possible locations including orderTotal
    let productPrice = 'N/A';
    if (paymentData.orderTotal) {
        // Extract number from "Rs 25.00" format
        const priceMatch = paymentData.orderTotal.match(/(\d+(?:\.\d+)?)/);
        productPrice = priceMatch ? priceMatch[1] : paymentData.orderTotal;
    } else if (paymentData.productPrice) {
        productPrice = paymentData.productPrice;
    } else if (variantPrice && variantPrice !== 'N/A') {
        productPrice = variantPrice;
    } else if (paymentData.orderItems && paymentData.orderItems[0] && paymentData.orderItems[0].price) {
        productPrice = paymentData.orderItems[0].price;
    }
    
    // Extract extra fields - try multiple possible locations
    let extraFieldsText = 'N/A';
    if (paymentData.extraFields && paymentData.extraFields.length > 0) {
        extraFieldsText = paymentData.extraFields.map(field => `${field.label}: ${field.value}`).join(', ');
    } else if (paymentData.orderItems && paymentData.orderItems.length > 0 && paymentData.orderItems[0].extraFields) {
        const extraFields = paymentData.orderItems[0].extraFields;
        if (extraFields.length > 0) {
            extraFieldsText = extraFields.map(field => `${field.label}: ${field.value}`).join(', ');
        }
    }
    
    const paymentMethod = paymentData.paymentMethod || 'N/A';
    const fullName = paymentData.fullName || paymentData.customerName || 'N/A';
    const phone = paymentData.phone || 'N/A';
    const email = paymentData.email || 'N/A';
    const paymentId = paymentData.id || paymentData.paymentId || 'N/A'; // Document ID is the primary payment ID
    
    // Format timestamp - try multiple possible locations
    let timestamp = new Date().toLocaleString();
    if (paymentData.createdAt && paymentData.createdAt._seconds) {
        timestamp = new Date(paymentData.createdAt._seconds * 1000).toLocaleString();
    } else if (paymentData.timestamp && paymentData.timestamp.seconds) {
        timestamp = new Date(paymentData.timestamp.seconds * 1000).toLocaleString();
    } else if (paymentData.timestamp && paymentData.timestamp._seconds) {
        timestamp = new Date(paymentData.timestamp._seconds * 1000).toLocaleString();
    }
    
    // Create message with all requested details
    const message = `New Payment Alert! 💰

Payment ID: ${paymentId}
Customer Name: ${fullName}
Phone: ${phone}
Email: ${email}
Product Name: ${productName}
Price: Rs ${productPrice}
Variant: ${variantLabel} (Rs ${variantPrice})
Extra Fields: ${extraFieldsText}
Payment Method: ${paymentMethod}
Time: ${timestamp}

💡 Quick Actions:
• Check status: "status ${paymentId}"
• Approve: "${paymentId} + approved"
• Reject: "${paymentId} + rejected"

Check Screenshot at: https://cgaph.com/admin.html`;
    
    return message;
}

// Function to start monitoring Firestore
function startFirestoreMonitoring() {
    console.log('🔍 Starting Firestore monitoring for "payments" collection...');
    
    const paymentsRef = db.collection('payments');
    
    // Listen for new documents
    paymentsRef.onSnapshot((snapshot) => {
        // Only process if server is running
        if (!isServerRunning) {
            return;
        }
        
        snapshot.docChanges().forEach((change) => {
            if (change.type === 'added') {
                const paymentData = {
                    id: change.doc.id,
                    ...change.doc.data()
                };
                
                console.log('💰 New payment detected:', paymentData);
                
                // Send WhatsApp notification
                sendWhatsAppMessage(paymentData).then((success) => {
                    if (success) {
                        console.log('✅ Payment notification sent successfully');
                    } else {
                        console.log('⚠️ Failed to send payment notification');
                    }
                });
            }
        });
    }, (error) => {
        console.error('❌ Error monitoring Firestore:', error);
        console.log('🔄 Retrying in 10 seconds...');
        setTimeout(startFirestoreMonitoring, 10000);
    });
}

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down gracefully...');
    client.destroy();
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n🛑 Shutting down gracefully...');
    client.destroy();
    process.exit(0);
});

// Start the application
async function startApp() {
    console.log('🚀 Starting Firebase-WhatsApp Order Notifier...');
    console.log('📋 Configuration:');
    console.log(`   - Firebase Project: ${process.env.FIREBASE_PROJECT_ID || 'Not set'}`);
    console.log(`   - WhatsApp Number: ${process.env.WHATSAPP_PHONE_NUMBER || 'Not set'}`);
    console.log('   - Monitoring Collection: payments');
    console.log('');
    
    // Initialize WhatsApp client with retry logic
    console.log('📱 Initializing WhatsApp client...');
    let retryCount = 0;
    const maxRetries = 3;
    
    while (retryCount < maxRetries) {
        try {
            await client.initialize();
            break;
        } catch (error) {
            retryCount++;
            console.log(`⚠️ Attempt ${retryCount} failed: ${error.message}`);
            if (retryCount < maxRetries) {
                console.log(`🔄 Retrying in 5 seconds... (${retryCount}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, 5000));
            } else {
                console.log('❌ Max retries reached. Please check your internet connection and try again.');
                throw error;
            }
        }
    }
    
    // Start monitoring Firestore after a short delay
    setTimeout(() => {
        startFirestoreMonitoring();
    }, 2000);
}

// Start the application
startApp().catch((error) => {
    console.error('❌ Failed to start application:', error);
    process.exit(1);
});
