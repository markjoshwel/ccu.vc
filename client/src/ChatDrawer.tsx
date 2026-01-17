import { useState, useEffect, useRef, useCallback } from 'react';
import type { ChatMessage } from '@ccu/shared';
import { getSocket } from './socket';

interface ChatDrawerProps {
  myPlayerId: string;
  onUnreadChange?: (count: number) => void;
}

export default function ChatDrawer({ myPlayerId, onUnreadChange }: ChatDrawerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [unreadCount, setUnreadCount] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(false);

  useEffect(() => {
    const socket = getSocket();
    
    socket.on('chatMessage', (msg: ChatMessage) => {
      setMessages(prev => [...prev, msg]);
      if (!isOpen) {
        setUnreadCount(prev => prev + 1);
      }
    });
    
    socket.on('chatHistory', (history: ChatMessage[]) => {
      setMessages(history);
    });

    return () => {
      socket.off('chatMessage');
      socket.off('chatHistory');
    };
  }, [isOpen]);

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isOpen]);

  // Clear unread when opening
  useEffect(() => {
    if (isOpen && !wasOpen.current) {
      setUnreadCount(0);
    }
    wasOpen.current = isOpen;
  }, [isOpen]);

  // Notify parent of unread changes
  useEffect(() => {
    onUnreadChange?.(unreadCount);
  }, [unreadCount, onUnreadChange]);

  const handleSend = useCallback(() => {
    const message = inputValue.trim();
    if (!message) return;
    
    const socket = getSocket();
    socket.emit('sendChat', { message });
    setInputValue('');
  }, [inputValue]);

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className={`chat-drawer ${isOpen ? 'open' : ''}`}>
      <button 
        className="chat-toggle"
        onClick={() => setIsOpen(!isOpen)}
      >
        💬 Chat
        {unreadCount > 0 && !isOpen && (
          <span className="unread-badge">{unreadCount}</span>
        )}
      </button>

      {isOpen && (
        <div className="chat-panel">
          <div className="chat-messages">
            {messages.length === 0 ? (
              <p className="no-messages">No messages yet</p>
            ) : (
              messages.map((msg, idx) => (
                <div 
                  key={idx} 
                  className={`chat-message ${msg.playerId === myPlayerId ? 'mine' : ''}`}
                >
                  <span className="message-time">{formatTime(msg.timestamp)}</span>
                  <span className="message-author">{msg.displayName}:</span>
                  <span className="message-text">{msg.message}</span>
                </div>
              ))
            )}
            <div ref={messagesEndRef} />
          </div>
          
          <div className="chat-input">
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Type a message..."
              maxLength={200}
            />
            <button onClick={handleSend} disabled={!inputValue.trim()}>
              Send
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
