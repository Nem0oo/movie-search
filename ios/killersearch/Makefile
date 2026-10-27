TARGET := iphone:clang:latest:16.5
ARCHS = arm64
INSTALL_TARGET_PROCESSES = KillerSearch

include $(THEOS)/makefiles/common.mk

APPLICATION_NAME = KillerSearch

KillerSearch_FILES = KillerSearchApp.swift ContentView.swift LoginView.swift Models.swift Persistence.swift TMDBService.swift GameService.swift FilterBuilder.swift GameViewModel.swift DebugView.swift
KillerSearch_FRAMEWORKS = UIKit SwiftUI Foundation AuthenticationServices
KillerSearch_SWIFTFLAGS = -swift-version 5

include $(THEOS_MAKE_PATH)/application.mk
