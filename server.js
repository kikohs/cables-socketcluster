const http = require('http');
const eetase = require('eetase');
const socketClusterServer = require('socketcluster-server');
const express = require('express');
const serveStatic = require('serve-static');
const path = require('path');
const morgan = require('morgan');
const uuid = require('uuid');
const sccBrokerClient = require('scc-broker-client');
const crypto = require('crypto');

const ENVIRONMENT = process.env.ENV || 'dev';
const SOCKETCLUSTER_PORT = process.env.SOCKETCLUSTER_PORT || process.env.PORT || 8000;
const SOCKETCLUSTER_WS_ENGINE = process.env.SOCKETCLUSTER_WS_ENGINE || 'ws';
const SOCKETCLUSTER_SOCKET_CHANNEL_LIMIT = Number(process.env.SOCKETCLUSTER_SOCKET_CHANNEL_LIMIT) || 1000;
const SOCKETCLUSTER_LOG_LEVEL = process.env.SOCKETCLUSTER_LOG_LEVEL || 2;
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH || 'abcd1d125e105ac581bffe425603814c368aeb07a8a0c56dc94ecb777d37cdad'; // Default hash - change in production

// Activity log to track connections, events, etc.
const activityLog = [];
const MAX_LOG_ENTRIES = 100;

// Active client tracking
let activeConnections = new Set();

// Helper to add log entry
function addLogEntry(type, details) {
  const timestamp = new Date().toISOString();
  const entry = { id: uuid.v4(), timestamp, type, details };
  activityLog.unshift(entry);
  
  // Keep log size manageable
  if (activityLog.length > MAX_LOG_ENTRIES) {
    activityLog.length = MAX_LOG_ENTRIES;
  }
  
  return entry;
}

// Get accurate connection count
function getConnectionCount() {
  return activeConnections.size;
}

const SCC_INSTANCE_ID = uuid.v4();
const SCC_STATE_SERVER_HOST = process.env.SCC_STATE_SERVER_HOST || null;
const SCC_STATE_SERVER_PORT = process.env.SCC_STATE_SERVER_PORT || null;
const SCC_MAPPING_ENGINE = process.env.SCC_MAPPING_ENGINE || null;
const SCC_CLIENT_POOL_SIZE = process.env.SCC_CLIENT_POOL_SIZE || null;
const SCC_AUTH_KEY = process.env.SCC_AUTH_KEY || null;
const SCC_INSTANCE_IP = process.env.SCC_INSTANCE_IP || null;
const SCC_INSTANCE_IP_FAMILY = process.env.SCC_INSTANCE_IP_FAMILY || null;
const SCC_STATE_SERVER_CONNECT_TIMEOUT = Number(process.env.SCC_STATE_SERVER_CONNECT_TIMEOUT) || null;
const SCC_STATE_SERVER_ACK_TIMEOUT = Number(process.env.SCC_STATE_SERVER_ACK_TIMEOUT) || null;
const SCC_STATE_SERVER_RECONNECT_RANDOMNESS = Number(process.env.SCC_STATE_SERVER_RECONNECT_RANDOMNESS) || null;
const SCC_PUB_SUB_BATCH_DURATION = Number(process.env.SCC_PUB_SUB_BATCH_DURATION) || null;
const SCC_BROKER_RETRY_DELAY = Number(process.env.SCC_BROKER_RETRY_DELAY) || null;

let agOptions = {};

if (process.env.SOCKETCLUSTER_OPTIONS) {
  let envOptions = JSON.parse(process.env.SOCKETCLUSTER_OPTIONS);
  Object.assign(agOptions, envOptions);
}

let httpServer = eetase(http.createServer());
let agServer = socketClusterServer.attach(httpServer, agOptions);

let expressApp = express();
if (ENVIRONMENT === 'dev') {
  // Log every HTTP request. See https://github.com/expressjs/morgan for other
  // available formats.
  expressApp.use(morgan('dev'));
}

// Add body parser for JSON
expressApp.use(express.json());
expressApp.use(express.urlencoded({ extended: true }));

// Simple cookie parser middleware
expressApp.use((req, res, next) => {
  const cookies = {};
  const cookieHeader = req.headers.cookie;
  
  if (cookieHeader) {
    cookieHeader.split(';').forEach(cookie => {
      const [name, value] = cookie.trim().split('=');
      cookies[name] = value;
    });
  }
  
  req.cookies = cookies;
  
  // Add cookie setter
  res.cookie = (name, value, options = {}) => {
    const cookieStr = `${name}=${value}`;
    const expires = options.expires ? `; Expires=${options.expires.toUTCString()}` : '';
    const path = options.path ? `; Path=${options.path}` : '; Path=/';
    const httpOnly = options.httpOnly ? '; HttpOnly' : '';
    
    res.setHeader('Set-Cookie', `${cookieStr}${expires}${path}${httpOnly}`);
    return res;
  };
  
  next();
});

// Authentication middleware for protected routes
const authenticateAdmin = (req, res, next) => {
  const token = req.headers['x-auth-token'] || req.cookies?.authToken;
  
  if (!token) {
    return res.redirect('/login.html');
  }
  
  // For simplicity, we're using the token directly (in a real app, use JWT or sessions)
  if (token === ADMIN_PASSWORD_HASH) {
    return next();
  }
  
  res.redirect('/login.html');
};

// Serve static files
expressApp.use('/api', authenticateAdmin); // Protect API routes
expressApp.use(serveStatic(path.resolve(__dirname, 'public')));

// Add GET /health-check express route
expressApp.get('/health-check', (req, res) => {
  res.status(200).send('OK');
});

// Authentication route
expressApp.post('/auth', (req, res) => {
  const { password } = req.body;
  
  if (!password) {
    return res.status(400).json({ success: false, message: 'Password is required' });
  }
  
  // Hash the provided password
  const hash = crypto.createHash('sha256').update(password).digest('hex');
  
  if (hash === ADMIN_PASSWORD_HASH) {
    addLogEntry('login', { success: true, ip: req.ip });
    
    // Set cookie for browser-based auth
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + 1); // 1 day expiry
    
    res.cookie('authToken', ADMIN_PASSWORD_HASH, {
      expires: expiryDate,
      httpOnly: true
    });
    
    return res.json({ success: true, token: ADMIN_PASSWORD_HASH });
  }
  
  addLogEntry('login', { success: false, ip: req.ip });
  res.status(401).json({ success: false, message: 'Invalid password' });
});

// API route to get activity logs
expressApp.get('/api/logs', (req, res) => {
  res.json({ logs: activityLog });
});

// API route to clear activity logs
expressApp.post('/api/logs/clear', (req, res) => {
  activityLog.length = 0;
  console.log('Activity logs cleared by admin');
  res.json({ success: true, message: 'Logs cleared successfully' });
});

// API route to get server stats
expressApp.get('/api/stats', (req, res) => {
  // Use our manually tracked active connections
  const connectionCount = getConnectionCount();
  
  res.json({
    uptime: process.uptime(),
    connectionCount: connectionCount,
    memoryUsage: process.memoryUsage(),
    instanceId: SCC_INSTANCE_ID
  });
});

// HTTP request handling loop.
(async () => {
  for await (let requestData of httpServer.listener('request')) {
    expressApp.apply(null, requestData);
  }
})();

// Setup middleware to intercept all messages
agServer.setMiddleware(agServer.MIDDLEWARE_INBOUND, async (middlewareStream) => {
  for await (let action of middlewareStream) {
    try {
      // Log all messages passing through the system
      if (['publish', 'invoke', 'transmit', 'subscribe', 'unsubscribe'].includes(action.type)) {
        // Removed console log for production
        
        const messageInfo = {
          type: action.type,
          socket_id: action.socket ? action.socket.id : 'server',
          channel: action.procedure || action.channel || action.path,
          data: typeof action.data === 'object' ? JSON.stringify(action.data) : action.data,
          timestamp: new Date().toISOString()
        };
        
        // Don't log the admin activity channel to prevent recursive logging
        if (action.channel !== 'activity' && action.path !== 'activity') {
          const logEntry = addLogEntry('message', messageInfo);
          
          // Notify admin dashboard
          (async () => {
            try {
              await agServer.exchange.transmitPublish('activity', {
                type: 'message',
                data: logEntry
              });
            } catch (err) {
              console.error('Error publishing message event:', err);
            }
          })();
        }
      }
    } catch (err) {
      console.error('Error in middleware processing:', err);
    }
    
    // Allow the action to be processed
    action.allow();
  }
});

// Also track outbound messages
agServer.setMiddleware(agServer.MIDDLEWARE_OUTBOUND, async (middlewareStream) => {
  for await (let action of middlewareStream) {
    try {
      // Log all messages passing through the system
      if (['publish', 'emit', 'transmit'].includes(action.type)) {
        // Removed console log for production
        
        const messageInfo = {
          type: action.type + '_out',
          socket_id: action.socket ? action.socket.id : 'server',
          channel: action.procedure || action.channel || action.path,
          data: typeof action.data === 'object' ? JSON.stringify(action.data) : action.data,
          timestamp: new Date().toISOString()
        };
        
        // Don't log the admin activity channel to prevent recursive logging
        if (action.channel !== 'activity' && action.path !== 'activity') {
          const logEntry = addLogEntry('message', messageInfo);
          
          // Notify admin dashboard - don't use transmitPublish here to avoid recursion
          try {
            agServer.exchange.invokePublish('activity', {
              type: 'message',
              data: logEntry
            });
          } catch (err) {
            console.error('Error publishing outbound message event:', err);
          }
        }
      }
    } catch (err) {
      console.error('Error in outbound middleware processing:', err);
    }
    
    // Allow the action to be processed
    action.allow();
  }
});

// SocketCluster/WebSocket connection handling loop.
(async () => {
  for await (let {socket} of agServer.listener('connection')) {
    // Log the new connection
    const connectionInfo = {
      id: socket.id,
      ip: socket.remoteAddress,
      url: socket.request ? socket.request.url : 'unknown',
      headers: socket.request ? socket.request.headers : {},
      timestamp: new Date().toISOString()
    };
    
    // Add to active connections
    activeConnections.add(socket.id);
    
    const logEntry = addLogEntry('connection', connectionInfo);
    
    // Broadcast the connection to all clients subscribed to the activity channel
    (async () => {
      try {
        await agServer.exchange.transmitPublish('activity', {
          type: 'connection',
          data: logEntry
        });
      } catch (err) {
        console.error('Error publishing connection event:', err);
      }
    })();
    
    // Track all socket subscriptions
    (async () => {
      for await (let {channel} of socket.listener('subscribe')) {
        // Skip logging activity channel subscriptions to reduce noise
        if (channel !== 'activity') {
          const subscriptionInfo = {
            socketId: socket.id,
            channel: channel,
            timestamp: new Date().toISOString()
          };
          
          const logEntry = addLogEntry('subscribe', subscriptionInfo);
          
          // Broadcast the subscription
          (async () => {
            try {
              await agServer.exchange.transmitPublish('activity', {
                type: 'subscribe',
                data: logEntry
              });
            } catch (err) {
              console.error('Error publishing subscribe event:', err);
            }
          })();
        }
        
        // Connection count is managed by activeConnections Set
      }
    })();
    
    // Track all socket unsubscriptions
    (async () => {
      for await (let {channel} of socket.listener('unsubscribe')) {
        const unsubscriptionInfo = {
          socketId: socket.id,
          channel: channel,
          timestamp: new Date().toISOString()
        };
        
        const logEntry = addLogEntry('unsubscribe', unsubscriptionInfo);
        
        // Broadcast the unsubscription
        (async () => {
          try {
            await agServer.exchange.transmitPublish('activity', {
              type: 'unsubscribe',
              data: logEntry
            });
          } catch (err) {
            console.error('Error publishing unsubscribe event:', err);
          }
        })();
      }
    })();
    
    // Handle socket disconnection
    (async () => {
      for await (let event of socket.listener('disconnect')) {
        const disconnectInfo = {
          id: socket.id,
          ip: socket.remoteAddress,
          timestamp: new Date().toISOString(),
          reason: event.code
        };
        
        // Remove from active connections
        activeConnections.delete(socket.id);
        
        const logEntry = addLogEntry('disconnect', disconnectInfo);
        
        // Broadcast the disconnection
        (async () => {
          try {
            await agServer.exchange.transmitPublish('activity', {
              type: 'disconnect',
              data: logEntry
            });
          } catch (err) {
            console.error('Error publishing disconnect event:', err);
          }
        })();
      }
    })();
    
    // Handle custom events from client
    (async () => {
      for await (let data of socket.procedure('registerEvent')) {
        if (data.event && data.details) {
          const eventInfo = {
            socketId: socket.id,
            event: data.event,
            details: data.details,
            timestamp: new Date().toISOString()
          };
          
          const logEntry = addLogEntry('customEvent', eventInfo);
          
          // Broadcast the event
          (async () => {
            try {
              await agServer.exchange.transmitPublish('activity', {
                type: 'customEvent',
                data: logEntry
              });
            } catch (err) {
              console.error('Error publishing custom event:', err);
            }
          })();
          
          return { success: true, logId: logEntry.id };
        }
        return { success: false, error: 'Invalid event data' };
      }
    })();
  }
})();

httpServer.listen(SOCKETCLUSTER_PORT);

if (SOCKETCLUSTER_LOG_LEVEL >= 1) {
  (async () => {
    for await (let {error} of agServer.listener('error')) {
      console.error(error);
    }
  })();
}

if (SOCKETCLUSTER_LOG_LEVEL >= 2) {
  console.log(
    `   ${colorText('[Active]', 32)} SocketCluster worker with PID ${process.pid} is listening on port ${SOCKETCLUSTER_PORT}`
  );

  (async () => {
    for await (let {warning} of agServer.listener('warning')) {
      console.warn(warning);
    }
  })();
}

function colorText(message, color) {
  if (color) {
    return `\x1b[${color}m${message}\x1b[0m`;
  }
  return message;
}

if (SCC_STATE_SERVER_HOST) {
  // Setup broker client to connect to SCC.
  let sccClient = sccBrokerClient.attach(agServer.brokerEngine, {
    instanceId: SCC_INSTANCE_ID,
    instancePort: SOCKETCLUSTER_PORT,
    instanceIp: SCC_INSTANCE_IP,
    instanceIpFamily: SCC_INSTANCE_IP_FAMILY,
    pubSubBatchDuration: SCC_PUB_SUB_BATCH_DURATION,
    stateServerHost: SCC_STATE_SERVER_HOST,
    stateServerPort: SCC_STATE_SERVER_PORT,
    mappingEngine: SCC_MAPPING_ENGINE,
    clientPoolSize: SCC_CLIENT_POOL_SIZE,
    authKey: SCC_AUTH_KEY,
    stateServerConnectTimeout: SCC_STATE_SERVER_CONNECT_TIMEOUT,
    stateServerAckTimeout: SCC_STATE_SERVER_ACK_TIMEOUT,
    stateServerReconnectRandomness: SCC_STATE_SERVER_RECONNECT_RANDOMNESS,
    brokerRetryDelay: SCC_BROKER_RETRY_DELAY
  });

  if (SOCKETCLUSTER_LOG_LEVEL >= 1) {
    (async () => {
      for await (let {error} of sccClient.listener('error')) {
        error.name = 'SCCError';
        console.error(error);
      }
    })();
  }
}
