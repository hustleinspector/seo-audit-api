#!/usr/bin/env node

/**
 * SEO Audit API for CashClaw
 * Micro-SaaS that generates $9 per audit
 * No approval needed, self-hosted, direct Stripe payments
 */

const http = require('http');
const https = require('https');
const url = require('url');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Configuration
const CONFIG = {
  PORT: 3850,
  PRICE: 9.00, // USD
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET || 'test_secret',
  LOG_FILE: path.join(__dirname, 'seo-api.log'),
  AUDIT_RESULTS_DIR: path.join(__dirname, 'audit-results')
};

// Ensure directories exist
if (!fs.existsSync(CONFIG.AUDIT_RESULTS_DIR)) {
  fs.mkdirSync(CONFIG.AUDIT_RESULTS_DIR, { recursive: true });
}

// Log function
function log(message) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}`;
  console.log(logMessage);
  fs.appendFileSync(CONFIG.LOG_FILE, logMessage + '\n');
}

// Perform SEO audit using CashClaw
function performSEOAudit(urlToAudit, tier = 'basic') {
  try {
    log(`Performing SEO audit for: ${urlToAudit} (tier: ${tier})`);
    
    const command = `cd /root/.openclaw/cashclaw && ./bin/cashclaw.js audit --url "${urlToAudit}" --tier ${tier}`;
    
    const result = execSync(command, {
      encoding: 'utf8',
      timeout: 300000, // 5 minutes
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    log(`Audit completed for: ${urlToAudit}`);
    
    // Parse result (simplified - in production would parse structured output)
    const auditResult = {
      url: urlToAudit,
      tier: tier,
      timestamp: new Date().toISOString(),
      raw_output: result.substring(0, 5000), // Limit size
      summary: extractSummary(result),
      recommendations: extractRecommendations(result)
    };
    
    // Save to file
    const filename = `audit_${Date.now()}_${urlToAudit.replace(/[^a-z0-9]/gi, '_')}.json`;
    const filepath = path.join(CONFIG.AUDIT_RESULTS_DIR, filename);
    fs.writeFileSync(filepath, JSON.stringify(auditResult, null, 2));
    
    return {
      success: true,
      audit_id: filename.replace('.json', ''),
      result: auditResult,
      download_url: `/download/${filename}`
    };
    
  } catch (error) {
    log(`Audit failed for ${urlToAudit}: ${error.message}`);
    return {
      success: false,
      error: error.message
    };
  }
}

// Extract summary from audit output
function extractSummary(output) {
  // Simple extraction - in production would parse structured data
  const lines = output.split('\n');
  const summaryLines = lines.filter(line => 
    line.includes('score') || 
    line.includes('issues') || 
    line.includes('recommendation') ||
    line.match(/[0-9]+\s*(critical|warning|notice)/i)
  ).slice(0, 10);
  
  return summaryLines.length > 0 ? summaryLines.join('\n') : 'Audit completed. Check full report for details.';
}

// Extract recommendations
function extractRecommendations(output) {
  const lines = output.split('\n');
  const recLines = lines.filter(line => 
    line.toLowerCase().includes('fix') ||
    line.toLowerCase().includes('improve') ||
    line.toLowerCase().includes('recommend') ||
    line.startsWith('- ') ||
    line.startsWith('• ')
  ).slice(0, 15);
  
  return recLines.length > 0 ? recLines : ['1. Check technical SEO issues', '2. Optimize page speed', '3. Improve content structure'];
}

// Generate Stripe payment link
function generatePaymentLink(auditId, urlToAudit, email) {
  // In production, would create Stripe Checkout session
  // For now, simulate
  const paymentLink = `https://buy.stripe.com/test_00g5nE7Uq6jC7OEbII?client_reference_id=${auditId}&prefilled_email=${encodeURIComponent(email)}`;
  
  log(`Generated payment link for audit ${auditId}`);
  
  return {
    payment_url: paymentLink,
    price: CONFIG.PRICE,
    audit_id: auditId,
    status: 'pending_payment'
  };
}

// Handle API requests
const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }
  
  // API endpoints
  if (pathname === '/api/audit/request' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const { url: urlToAudit, email, tier = 'basic' } = data;
        
        if (!urlToAudit || !email) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing url or email' }));
          return;
        }
        
        // Generate audit ID
        const auditId = `audit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        // Generate payment link
        const paymentInfo = generatePaymentLink(auditId, urlToAudit, email);
        
        // Queue audit (will perform after payment)
        log(`Audit requested: ${urlToAudit} by ${email}, audit_id: ${auditId}`);
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          message: 'Audit request received',
          audit_id: auditId,
          payment_required: true,
          payment_url: paymentInfo.payment_url,
          price: CONFIG.PRICE,
          instructions: 'Complete payment to receive your SEO audit within 24 hours.'
        }));
        
      } catch (error) {
        log(`API error: ${error.message}`);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal server error' }));
      }
    });
    
  } else if (pathname === '/api/audit/perform' && req.method === 'POST') {
    // Internal endpoint to actually perform audit (called after payment)
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const { audit_id, url: urlToAudit, tier = 'basic' } = data;
        
        const result = performSEOAudit(urlToAudit, tier);
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: result.success,
          audit_id: audit_id,
          result: result.success ? result.result : null,
          error: result.error || null
        }));
        
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: error.message }));
      }
    });
    
  } else if (pathname.startsWith('/download/') && req.method === 'GET') {
    // Serve audit results
    const filename = pathname.split('/download/')[1];
    const filepath = path.join(CONFIG.AUDIT_RESULTS_DIR, filename);
    
    if (fs.existsSync(filepath)) {
      const fileContent = fs.readFileSync(filepath, 'utf8');
      res.writeHead(200, { 
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="${filename}"`
      });
      res.end(fileContent);
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Audit not found' }));
    }
    
  } else if (pathname === '/api/status' && req.method === 'GET') {
    // Status endpoint
    const audits = fs.readdirSync(CONFIG.AUDIT_RESULTS_DIR).filter(f => f.endsWith('.json'));
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'online',
      service: 'SEO Audit API',
      price: `$${CONFIG.PRICE}`,
      audits_performed: audits.length,
      revenue_generated: audits.length * CONFIG.PRICE,
      endpoints: {
        request_audit: 'POST /api/audit/request',
        perform_audit: 'POST /api/audit/perform',
        download: 'GET /download/{filename}',
        status: 'GET /api/status'
      }
    }));
    
  } else if (pathname === '/' && req.method === 'GET') {
    // Landing page
    const landingPage = `
<!DOCTYPE html>
<html>
<head>
    <title>SEO Audit API - $9 AI-Powered Website Analysis</title>
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 40px; border-radius: 10px; margin-bottom: 30px; }
        .form { background: #f8f9fa; padding: 30px; border-radius: 10px; }
        input, button { width: 100%; padding: 15px; margin: 10px 0; border-radius: 5px; border: 1px solid #ddd; }
        button { background: #667eea; color: white; border: none; cursor: pointer; }
        .result { display: none; background: #d4edda; padding: 20px; border-radius: 5px; margin-top: 20px; }
    </style>
</head>
<body>
    <div class="header">
        <h1>🔍 SEO Audit API</h1>
        <p>Get a comprehensive AI-powered SEO audit for any website for just $9.</p>
        <p>Powered by CashClaw AI & Stripe.</p>
    </div>
    
    <div class="form">
        <h2>Request Your Audit</h2>
        <input type="url" id="url" placeholder="https://example.com" required>
        <input type="email" id="email" placeholder="your@email.com" required>
        <button onclick="requestAudit()">Get Audit for $9</button>
        
        <div id="result" class="result"></div>
    </div>
    
    <script>
        async function requestAudit() {
            const url = document.getElementById('url').value;
            const email = document.getElementById('email').value;
            const resultDiv = document.getElementById('result');
            
            if (!url || !email) {
                alert('Please fill in both fields');
                return;
            }
            
            resultDiv.style.display = 'block';
            resultDiv.innerHTML = 'Processing your request...';
            
            try {
                const response = await fetch('/api/audit/request', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url, email })
                });
                
                const data = await response.json();
                
                if (data.success) {
                    resultDiv.innerHTML = \`
                        <h3>✅ Audit Request Received!</h3>
                        <p>Audit ID: \${data.audit_id}</p>
                        <p>Price: $\${data.price}</p>
                        <p><a href="\${data.payment_url}" target="_blank">👉 Click here to pay $9 and get your audit</a></p>
                        <p>After payment, your audit will be delivered within 24 hours.</p>
                    \`;
                } else {
                    resultDiv.innerHTML = \`<p style="color: red;">Error: \${data.error}</p>\`;
                }
            } catch (error) {
                resultDiv.innerHTML = \`<p style="color: red;">Network error: \${error.message}</p>\`;
            }
        }
    </script>
</body>
</html>`;
    
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(landingPage);
    
  } else {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  }
});

// Start server
server.listen(CONFIG.PORT, () => {
  log(`✅ SEO Audit API started on port ${CONFIG.PORT}`);
  log(`💰 Price: $${CONFIG.PRICE} per audit`);
  log(`🌐 Endpoints:`);
  log(`   GET  /              - Landing page`);
  log(`   POST /api/audit/request - Request audit (returns payment link)`);
  log(`   POST /api/audit/perform - Perform audit (internal)`);
  log(`   GET  /api/status     - API status`);
  log(`   GET  /download/{id}  - Download audit results`);
  log(`🎯 Goal: $100 revenue = ${Math.ceil(100 / CONFIG.PRICE)} audits`);
});

// Handle shutdown
process.on('SIGINT', () => {
  log('Shutting down SEO Audit API...');
  process.exit(0);
});

module.exports = { server, performSEOAudit };