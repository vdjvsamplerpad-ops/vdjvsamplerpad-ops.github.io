'use client';

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';

import { cn } from '@/lib/utils';

let historyDialogDepth = 0;

type DialogProps = React.ComponentPropsWithoutRef<typeof DialogPrimitive.Root> & {
  useHistory?: boolean;
};

const Dialog = ({ open, onOpenChange, useHistory = true, ...props }: DialogProps) => {
  const pushedStateRef = React.useRef(false);
  const closingFromAppRef = React.useRef(false);
  const ownsHistoryRef = React.useRef(false);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!useHistory) return;

    if (open) {
      if (!pushedStateRef.current && historyDialogDepth === 0) {
        window.history.pushState({ vdjvDialog: true }, '');
        pushedStateRef.current = true;
        ownsHistoryRef.current = true;
      }
      historyDialogDepth += 1;

      const handlePopState = () => {
        if (!ownsHistoryRef.current) return;
        if (closingFromAppRef.current) {
          closingFromAppRef.current = false;
          return;
        }
        if (pushedStateRef.current) {
          pushedStateRef.current = false;
          onOpenChange?.(false);
        }
      };

      if (ownsHistoryRef.current) {
        window.addEventListener('popstate', handlePopState);
      }
      return () => {
        historyDialogDepth = Math.max(0, historyDialogDepth - 1);
        if (ownsHistoryRef.current) {
          window.removeEventListener('popstate', handlePopState);
        }
      };
    }

    if (pushedStateRef.current && ownsHistoryRef.current) {
      pushedStateRef.current = false;
      closingFromAppRef.current = true;
      window.history.back();
    }
    ownsHistoryRef.current = false;
  }, [open, onOpenChange, useHistory]);

  return <DialogPrimitive.Root open={open} onOpenChange={onOpenChange} {...props} />;
};

const DialogTrigger = DialogPrimitive.Trigger;

const DialogPortal = DialogPrimitive.Portal;

const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      'fixed inset-0 z-50 bg-black/80  data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
      className,
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

type DialogContentProps = React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
  hideCloseButton?: boolean;
};

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  DialogContentProps
>(({ className, children, hideCloseButton = false, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        'fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg max-h-[85vh] translate-x-[-50%] translate-y-[-50%] gap-4 overflow-y-auto border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg',
        className,
      )}
      onInteractOutside={(event) => {
        event.preventDefault();
      }}
      onEscapeKeyDown={(event) => {
        event.preventDefault();
      }}
      {...props}
    >
      {children}
      {!hideCloseButton && (
        <DialogPrimitive.Close
          className={cn(
            'absolute right-4 top-4 h-8 w-8 p-0 rounded-md border transition-colors inline-flex items-center justify-center leading-none',
            'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none',
            'border-red-300 bg-red-50 text-red-600 hover:bg-red-100 hover:text-red-700',
            'dark:border-red-500/50 dark:bg-red-900/40 dark:text-red-300 dark:hover:bg-red-800/60 dark:hover:text-red-100'
          )}
        >
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      )}
    </DialogPrimitive.Content>
  </DialogPortal>
));
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      'flex flex-col space-y-1.5 text-center sm:text-left',
      className,
    )}
    {...props}
  />
);
DialogHeader.displayName = 'DialogHeader';

const DialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      'flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2',
      className,
    )}
    {...props}
  />
);
DialogFooter.displayName = 'DialogFooter';

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn(
      'text-lg font-semibold leading-none tracking-tight',
      className,
    )}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn('text-sm text-muted-foreground', className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
