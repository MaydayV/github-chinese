#import <Cocoa/Cocoa.h>
#include <stdlib.h>

extern void goOnCopyURL(void);
extern void goOnQuit(void);

@interface GhcnTrayTarget : NSObject
- (void)onCopyURL:(id)sender;
- (void)onQuit:(id)sender;
@end

static NSStatusItem *gStatusItem = nil;
static NSMenuItem *gCopyItem = nil;
static GhcnTrayTarget *gTarget = nil;
static NSString *gDefaultCopyTitle = nil;

@implementation GhcnTrayTarget
- (void)onCopyURL:(id)sender {
    (void)sender;
    goOnCopyURL();
}

- (void)onQuit:(id)sender {
    (void)sender;
    goOnQuit();
}
@end

void ghcnShowAlert(const char *title, const char *message) {
    @autoreleasepool {
        [NSApplication sharedApplication];
        [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];
        [NSApp activateIgnoringOtherApps:YES];

        NSAlert *alert = [[NSAlert alloc] init];
        alert.alertStyle = NSAlertStyleInformational;
        alert.messageText = title ? [NSString stringWithUTF8String:title] : @"Index-Translate 本地代理";
        alert.informativeText = message ? [NSString stringWithUTF8String:message] : @"";
        [alert addButtonWithTitle:@"好"];
        [alert runModal];
    }
}

void ghcnCopyText(const char *text) {
    @autoreleasepool {
        NSString *str = text ? [NSString stringWithUTF8String:text] : @"";
        NSPasteboard *pb = [NSPasteboard generalPasteboard];
        [pb clearContents];
        [pb setString:str forType:NSPasteboardTypeString];

        dispatch_async(dispatch_get_main_queue(), ^{
            if (gCopyItem) {
                [gCopyItem setTitle:@"已复制接口地址 ✓"];
                dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(1.5 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
                    if (gCopyItem && gDefaultCopyTitle) {
                        [gCopyItem setTitle:gDefaultCopyTitle];
                    }
                });
            }
        });
    }
}

void ghcnHideTray(void) {
    dispatch_async(dispatch_get_main_queue(), ^{
        if (gStatusItem) {
            [[NSStatusBar systemStatusBar] removeStatusItem:gStatusItem];
            gStatusItem = nil;
        }
        gCopyItem = nil;
    });
}

void ghcnTerminateApp(void) {
    dispatch_async(dispatch_get_main_queue(), ^{
        [NSApp terminate:nil];
    });
}

void ghcnRunTray(
    const void *iconBytes,
    int iconLen,
    const char *statusTitle,
    const char *copyTitle,
    const char *quitTitle,
    const char *tooltip
) {
    @autoreleasepool {
        [NSApplication sharedApplication];
        [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];

        gTarget = [[GhcnTrayTarget alloc] init];
        gDefaultCopyTitle = copyTitle ? [NSString stringWithUTF8String:copyTitle] : @"复制接口地址";

        gStatusItem = [[NSStatusBar systemStatusBar] statusItemWithLength:NSSquareStatusItemLength];
        if (gStatusItem.button) {
            if (iconBytes && iconLen > 0) {
                NSData *data = [NSData dataWithBytes:iconBytes length:(NSUInteger)iconLen];
                NSImage *img = [[NSImage alloc] initWithData:data];
                if (img) {
                    [img setSize:NSMakeSize(18, 18)];
                    [img setTemplate:NO];
                    gStatusItem.button.image = img;
                }
            }
            if (!gStatusItem.button.image) {
                gStatusItem.button.title = @"译";
            }
            if (tooltip) {
                gStatusItem.button.toolTip = [NSString stringWithUTF8String:tooltip];
            }
        }

        NSMenu *menu = [[NSMenu alloc] initWithTitle:@"IndexTranslateBridge"];
        [menu setAutoenablesItems:NO];

        NSMenuItem *statusItem = [[NSMenuItem alloc]
            initWithTitle:(statusTitle ? [NSString stringWithUTF8String:statusTitle] : @"代理运行中")
                   action:nil
            keyEquivalent:@""];
        [statusItem setEnabled:NO];
        [menu addItem:statusItem];

        gCopyItem = [[NSMenuItem alloc]
            initWithTitle:gDefaultCopyTitle
                   action:@selector(onCopyURL:)
            keyEquivalent:@""];
        [gCopyItem setTarget:gTarget];
        [menu addItem:gCopyItem];

        [menu addItem:[NSMenuItem separatorItem]];

        NSMenuItem *quitItem = [[NSMenuItem alloc]
            initWithTitle:(quitTitle ? [NSString stringWithUTF8String:quitTitle] : @"退出")
                   action:@selector(onQuit:)
            keyEquivalent:@"q"];
        [quitItem setTarget:gTarget];
        [menu addItem:quitItem];

        gStatusItem.menu = menu;

        [NSApp finishLaunching];
        [NSApp run];
    }
}
