import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import { Notification, NotificationType } from '../../hooks/useNotifications';

const ICONS: Record<NotificationType, React.ReactNode> = {
  info: <Info size={16} className="text-accent-cyan" />,
  success: <CheckCircle2 size={16} className="text-green-400" />,
  error: <XCircle size={16} className="text-red-400" />,
  warning: <AlertTriangle size={16} className="text-yellow-400" />,
};

const BORDERS: Record<NotificationType, string> = {
  info: 'border-accent-cyan/30',
  success: 'border-green-400/30',
  error: 'border-red-400/30',
  warning: 'border-yellow-400/30',
};

interface Props {
  notifications: Notification[];
  onDismiss: (id: number) => void;
}

export const NotificationToast: React.FC<Props> = ({ notifications, onDismiss }) => {
  return (
    <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 w-80 pointer-events-none">
      <AnimatePresence>
        {notifications.map(n => (
          <motion.div
            key={n.id}
            initial={{ opacity: 0, x: 80 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 80 }}
            className={`pointer-events-auto bg-panel border ${BORDERS[n.type]} rounded-lg p-3 shadow-2xl flex items-start gap-2`}
          >
            <div className="mt-0.5 shrink-0">{ICONS[n.type]}</div>
            <p className="text-xs text-gray-300 flex-1">{n.message}</p>
            <button onClick={() => onDismiss(n.id)} className="text-gray-500 hover:text-white shrink-0">
              <X size={14} />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
};
