#import <React/RCTBridgeModule.h>
#import <pthread.h>

// Forward declaration of QEMU's primary C entry point
extern int qemu_main(int argc, char **argv);

@interface LinuxVMBridge : NSObject <RCTBridgeModule>
@end

@implementation LinuxVMBridge {
    BOOL _isRunning;
}

RCT_EXPORT_MODULE();

+ (BOOL)requiresMainQueueSetup {
    return NO;
}

static void *vm_thread_worker(void *arg) {
    char **argv = (char **)arg;
    int argc = 0;
    while (argv[argc] != NULL) {
        argc++;
    }
    
    // Launch headless QEMU interpreter
    qemu_main(argc, argv);
    
    for (int i = 0; i < argc; i++) {
        free(argv[i]);
    }
    free(argv);
    return NULL;
}

RCT_EXPORT_METHOD(startVM:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
    if (_isRunning) {
        resolve(@"VM is already running");
        return;
    }
    
    NSString *docs = [NSSearchPathForDirectoriesInDomains(NSDocumentDirectory, NSUserDomainMask, YES) firstObject];
    NSString *workspace = [docs stringByAppendingPathComponent:@"workspace"];
    NSString *bundle = [[NSBundle mainBundle] bundlePath];
    
    [[NSFileManager defaultManager] createDirectoryAtPath:workspace withIntermediateDirectories:YES attributes:nil error:nil];
    
    NSArray<NSString *> *qemuArgs = @[
        @"qemu-system-aarch64",
        @"-M", @"virt",
        @"-cpu", @"cortex-a57",
        @"-smp", @"1",
        @"-m", @"512M",
        @"-kernel", [bundle stringByAppendingPathComponent:@"vmlinuz-virt"],
        @"-initrd", [bundle stringByAppendingPathComponent:@"initramfs-virt.cpio.gz"],
        @"-append", @"console=ttyAMA0 mitigations=off",
        @"-fsdev", [NSString stringWithFormat:@"local,id=ws,path=%@,security_model=none", workspace],
        @"-device", @"virtio-9p-pci,fsdev=ws,mount_tag=host_workspace",
        @"-netdev", @"user,id=net0,hostfwd=tcp::3000-:3000,hostfwd=tcp::5173-:5173",
        @"-device", @"virtio-net-pci,netdev=net0",
        @"-chardev", @"socket,id=serial0,port=4000,host=127.0.0.1,server=on,wait=off",
        @"-serial", @"chardev:serial0",
        @"-nographic"
    ];
    
    int count = (int)[qemuArgs count];
    char **argv = malloc(sizeof(char *) * (count + 1));
    for (int i = 0; i < count; i++) {
        argv[i] = strdup([[qemuArgs objectAtIndex:i] UTF8String]);
    }
    argv[count] = NULL;
    
    pthread_t thread;
    if (pthread_create(&thread, NULL, vm_thread_worker, (void *)argv) != 0) {
        free(argv);
        reject(@"ERR_VM_THREAD", @"Failed to spawn QEMU pthread", nil);
        return;
    }
    pthread_detach(thread);
    
    _isRunning = YES;
    resolve(@"VM initialized on background thread. Serial listening on 127.0.0.1:4000");
}

@end