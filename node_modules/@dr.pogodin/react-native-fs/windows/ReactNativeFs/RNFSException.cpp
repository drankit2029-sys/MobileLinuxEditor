#include "pch.h"

#include "RNFSException.h"

RNFSException::RNFSException(std::string&& message) {
  this->Message = std::move(message);
}

const char* RNFSException::what() {
  return this->Message.c_str();
}
