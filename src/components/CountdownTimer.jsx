import React, { useState, useEffect } from 'react';
import { Clock } from 'lucide-react';
import { formatCountdown } from '../utils';

export default function CountdownTimer({ expiresAt, onExpire }) {
  const [remaining, setRemaining] = useState(() => {
    return Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
  });

  useEffect(() => {
    const updateTime = () => {
      const diff = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
      setRemaining(diff);
      if (diff <= 0 && onExpire) {
        onExpire();
      }
    };

    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, [expiresAt, onExpire]);

  const isUrgent = remaining < 900; // less than 15 minutes left

  if (remaining <= 0) {
    return (
      <span className="timer-pill urgent">
        <Clock size={14} /> Expired
      </span>
    );
  }

  return (
    <span className={`timer-pill ${isUrgent ? 'urgent' : ''}`} title="Time until automatic deletion">
      <Clock size={14} /> {formatCountdown(remaining)} left
    </span>
  );
}
