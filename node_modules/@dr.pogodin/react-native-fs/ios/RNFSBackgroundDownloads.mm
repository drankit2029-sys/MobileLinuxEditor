//
//  RNFSBackgroundDownloads.m
//  dr-pogodin-react-native-fs
//
//  Created by Sergey Pogodin on 29/1/24.
//

#import "RNFSBackgroundDownloads.h"

@implementation RNFSBackgroundDownloads;

static NSMutableDictionary *completionHandlers;

+ (void)complete:(NSString *)uuid
{
  CompletionHandler completionHandler = [completionHandlers objectForKey:uuid];
  if (completionHandler) {
      completionHandler();
      [completionHandlers removeObjectForKey:uuid];
  }
}

+ (void)setCompletionHandlerForIdentifier:(NSString *)identifier completionHandler:(__strong CompletionHandler)completionHandler
{
  if (!completionHandlers) completionHandlers = [[NSMutableDictionary alloc] init];
  [completionHandlers setValue:completionHandler forKey:identifier];
}

@end;
